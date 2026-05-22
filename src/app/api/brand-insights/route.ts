import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  searchPublicPosts,
  searchPublicComments,
  fetchUserComments,
  fetchPostThreadComments,
  fetchSubredditRecentComments,
} from "@/lib/reddit-public";
import type { RedditSearchResult } from "@/lib/reddit";

export const maxDuration = 60;

// Brand variants. People write "Social Champ" as "socialchamp" or
// "social-champ" too — catch all forms in one pass.
function brandVariants(brand: string): string[] {
  const trimmed = brand.toLowerCase().trim();
  const variants = new Set<string>([trimmed]);
  if (/\s/.test(trimmed)) {
    variants.add(trimmed.replace(/\s+/g, ""));      // socialchamp
    variants.add(trimmed.replace(/\s+/g, "-"));     // social-champ
    variants.add(trimmed.replace(/\s+/g, "_"));     // social_champ
  }
  return Array.from(variants);
}

// Filter Reddit results to those that contain ANY brand variant in title
// or body. Reddit's search index returns loose matches; we verify the brand
// string appears character-for-character (case-insensitive) before keeping.
function relevant(brand: string, r: RedditSearchResult): boolean {
  const variants = brandVariants(brand);
  const haystack = `${r.title ?? ""} ${r.content ?? ""}`.toLowerCase();
  return variants.some((v) => v.length >= 2 && haystack.includes(v));
}

// Curated list of subreddits where social-media-tool brands typically get
// discussed. Used as a fallback so the subreddit-recent-comments scan still
// covers ground even when the post search itself returns few results.
const CURATED_SM_SUBS = [
  "socialmedia",
  "SocialMediaMarketing",
  "SocialMediaManagers",
  "SMM_EXPERTS",
  "SocialMediaSchedulers",
  "SaaS",
  "marketing",
  "DigitalMarketing",
  "Entrepreneur",
  "smallbusiness",
  "SideProject",
  "bloggersmania",
  "Blogging",
  "GrowthHacking",
  "AgencyLife",
];

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

/**
 * Group results into the trailing N months, in chronological order.
 * Returns one entry per month even when count is zero so the chart has a
 * continuous x-axis.
 */
function buildMonthlySeries(results: RedditSearchResult[], months: number) {
  const counts = new Map<string, number>();
  for (const r of results) {
    counts.set(monthKey(r.createdUtc), (counts.get(monthKey(r.createdUtc)) ?? 0) + 1);
  }

  const series: { month: string; label: string; count: number }[] = [];
  const today = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const k = monthKey(d);
    series.push({ month: k, label: monthLabel(d), count: counts.get(k) ?? 0 });
  }
  return series;
}

function computeTrend(series: { count: number }[]): {
  direction: "up" | "down" | "flat";
  changePct: number;
  recentTotal: number;
  priorTotal: number;
} {
  // Compare last 3 months to the 3 months before that.
  const recent = series.slice(-3).reduce((s, m) => s + m.count, 0);
  const prior = series.slice(-6, -3).reduce((s, m) => s + m.count, 0);
  if (prior === 0 && recent === 0) {
    return { direction: "flat", changePct: 0, recentTotal: recent, priorTotal: prior };
  }
  if (prior === 0) {
    return { direction: "up", changePct: 100, recentTotal: recent, priorTotal: prior };
  }
  const changePct = Math.round(((recent - prior) / prior) * 100);
  const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";
  return { direction, changePct, recentTotal: recent, priorTotal: prior };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const brand = (url.searchParams.get("brand") ?? "").trim();
  const username = (url.searchParams.get("username") ?? "").trim();
  if (!brand || brand.length < 2) {
    return NextResponse.json({ error: "Brand must be at least 2 characters" }, { status: 400 });
  }

  try {
    // Pull a full year. limit=100 is Reddit's per-request cap for unauthenticated.
    const [rawPosts, rawComments] = await Promise.all([
      searchPublicPosts(brand, { limit: 100, t: "year" }),
      searchPublicComments(brand, { limit: 100, t: "year" }),
    ]);

    const posts = rawPosts.filter((r) => relevant(brand, r));
    let comments = rawComments.filter((r) => relevant(brand, r));

    // Deep scan: for EVERY matching post (up to 50), fetch the thread's
    // comment tree and pull any comments mentioning the brand. Catches in-
    // thread mentions pullpush.io's sparse archive misses entirely. Reddit
    // unauthenticated rate-limit tolerates ~10 req/sec briefly, so we run
    // in batches of 5 with a short pause between batches.
    const deepScanTargets = posts.slice(0, 15);
    if (deepScanTargets.length) {
      const batchSize = 5;
      for (let i = 0; i < deepScanTargets.length; i += batchSize) {
        const batch = deepScanTargets.slice(i, i + batchSize);
        const arrs = await Promise.all(
          batch.map((p) => {
            const permalink = p.url.replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com/, "");
            return fetchPostThreadComments(permalink, brand).catch(
              () => [] as RedditSearchResult[]
            );
          })
        );
        for (const arr of arrs) comments.push(...arr);
        if (i + batchSize < deepScanTargets.length) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    // Subreddit-recent scan: for each subreddit where the brand is being
    // discussed (top 5 by post volume), pull the sub's last 100 comments and
    // keep the ones mentioning the brand. Catches "blind" mentions — comments
    // about the brand in threads whose post doesn't itself mention it.
    // We compute the top subreddits from the post results inline because
    // topSubreddits (the response-shape version) is built after this block.
    const subCountsForScan: Record<string, number> = {};
    for (const p of posts) subCountsForScan[p.subreddit] = (subCountsForScan[p.subreddit] ?? 0) + 1;
    const topSubs = Object.entries(subCountsForScan)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);
    // Merge with curated SM subs and dedupe (case-insensitive).
    const merged = new Map<string, string>();
    for (const s of [...topSubs, ...CURATED_SM_SUBS.slice(0, 6)]) {
      if (!merged.has(s.toLowerCase())) merged.set(s.toLowerCase(), s);
    }
    const scanSubs = Array.from(merged.values());

    // Batch subreddit scans to stay under Reddit's unauthenticated rate limit.
    if (scanSubs.length) {
      const subBatch = 5;
      for (let i = 0; i < scanSubs.length; i += subBatch) {
        const batch = scanSubs.slice(i, i + subBatch);
        const arrs = await Promise.all(
          batch.map((s) =>
            fetchSubredditRecentComments(s, brand, { limit: 100 }).catch(
              () => [] as RedditSearchResult[]
            )
          )
        );
        for (const arr of arrs) comments.push(...arr);
        if (i + subBatch < scanSubs.length) {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
    }

    // Username scan: pull the user's last ~1000 comments and keep those that
    // mention the brand. This is how a brand operator finds their own
    // outreach comments even when pullpush hasn't indexed them.
    let userCommentsFound = 0;
    if (username) {
      try {
        const userComments = await fetchUserComments(username);
        const filtered = userComments.filter((r) => relevant(brand, r));
        userCommentsFound = filtered.length;
        comments.push(...filtered);
      } catch (err) {
        console.warn(`[brand-insights] user fetch failed for u/${username}:`, (err as Error).message);
      }
    }

    // Dedupe comments by reddit id (first pass — needed before author expansion
    // so we don't double-fetch the same author from multiple sources).
    {
      const seenIds = new Set<string>();
      comments = comments.filter((c) => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });
    }

    // Author auto-expansion: any account we found commenting about the brand,
    // pull their full recent comment history and harvest more brand mentions.
    // Catches the case where we caught one emilyinpak comment via subreddit-
    // recent scan — we then discover she has 100+ more about the brand.
    // Cap at top 12 distinct authors to keep latency bounded.
    const authorCounts: Record<string, number> = {};
    for (const c of comments) {
      if (!c.author || c.author === "[deleted]") continue;
      if (username && c.author.toLowerCase() === username.toLowerCase()) continue;
      authorCounts[c.author] = (authorCounts[c.author] ?? 0) + 1;
    }
    // Expand the top distinct authors by appearance count. Sort by count desc
    // so even low-volume authors (someone with one brand comment in our seed)
    // get pulled in — that's the snowball that turns one accidental match
    // into all their brand-related comments.
    const expandAuthors = Object.entries(authorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([author]) => author);

    // Reddit's unauthenticated rate limit is ~60 req/min. Each fetchUserComments
    // call internally paginates (maxPages * 1 req each), so we serialize the
    // whole expansion phase with delays. 12 authors × 5 pages × 600ms = ~36s,
    // staying comfortably under the limit.
    if (expandAuthors.length) {
      for (const a of expandAuthors) {
        try {
          const userCs = await fetchUserComments(a, { maxPages: 2 });
          const filtered = userCs.filter((r) => relevant(brand, r));
          comments.push(...filtered);
        } catch (err) {
          console.warn(`[expand] u/${a} failed: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    // Final dedupe after author expansion pulled in more results.
    {
      const seenIds = new Set<string>();
      comments = comments.filter((c) => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });
    }

    const combined = [...posts, ...comments].sort(
      (a, b) => b.createdUtc.getTime() - a.createdUtc.getTime()
    );

    // When the user provided a username, sort their own comments to the TOP
    // of the comments list so they're not buried under pullpush's archive.
    if (username) {
      const usernameLc = username.toLowerCase();
      comments.sort((a, b) => {
        const aIsUser = a.author.toLowerCase() === usernameLc ? 0 : 1;
        const bIsUser = b.author.toLowerCase() === usernameLc ? 0 : 1;
        if (aIsUser !== bIsUser) return aIsUser - bIsUser;
        return b.createdUtc.getTime() - a.createdUtc.getTime();
      });
    } else {
      comments.sort((a, b) => b.createdUtc.getTime() - a.createdUtc.getTime());
    }
    const monthly = buildMonthlySeries(combined, 12);
    const trend = computeTrend(monthly);

    // Aggregate top subreddits across both types.
    const subredditCounts: Record<string, number> = {};
    for (const r of combined) {
      subredditCounts[r.subreddit] = (subredditCounts[r.subreddit] ?? 0) + 1;
    }
    const topSubreddits = Object.entries(subredditCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([subreddit, count]) => ({ subreddit, count }));

    return NextResponse.json({
      brand,
      username: username || null,
      total: combined.length,
      postCount: posts.length,
      commentCount: comments.length,
      userCommentsFound,
      posts: posts.slice(0, 200),
      comments: comments.slice(0, 500),
      monthly,
      trend,
      topSubreddits,
    });
  } catch (err) {
    console.error("[brand-insights] error:", err);
    return NextResponse.json({ error: "Failed to fetch brand insights" }, { status: 500 });
  }
}
