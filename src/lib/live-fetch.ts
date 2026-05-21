/**
 * Server-side helper that pulls live Reddit data for one or more keywords
 * and persists results into the local DB as RedditPost + Match rows.
 * Used by /api/live/refresh and the keyword-create handler.
 *
 * No BullMQ, no Redis — just a synchronous fetch + upsert. Slow with many
 * keywords, but fine for the on-demand model the UI uses.
 */
import { prisma } from "./prisma";
import { searchPublicAll, type TimeRange } from "./reddit-public";
import { sendMatchAlert } from "./email";

// Cap per-refresh emails so a backfill that finds 50 matches doesn't blast
// the user with 50 emails. Anything above this gets squelched.
const MAX_EMAILS_PER_REFRESH = 5;

interface RefreshOptions {
  /** Reddit time-range filter for the search query. */
  t?: TimeRange;
  /** Max items per type per keyword. */
  limit?: number;
}

export interface RefreshResult {
  keyword: string;
  fetched: number;
  newMatches: number;
}

// Reddit's `q="..."` quoting is supposed to do exact-phrase matching but in
// practice it's flaky — the search index is keyword-based and returns loosely
// related threads. We validate every result by checking the actual title +
// body for the keyword before persisting it.
//
// For single-word keywords ("hootsuite") we keep the strict literal match.
//
// For multi-word keywords ("social media scheduler"), the literal match was
// too narrow — a post titled "Best social media scheduling tools?" would get
// rejected because "scheduler" ≠ "scheduling". So we fall back to a softer
// rule: every meaningful token from the keyword must appear in the post,
// with simple plural/singular and "-ing/-er" stem tolerance per token.
function tokenMatches(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  // Plural ↔ singular: scheduler ↔ schedulers, tools ↔ tool
  if (token.endsWith("s") && haystack.includes(token.slice(0, -1))) return true;
  if (!token.endsWith("s") && haystack.includes(token + "s")) return true;
  // Verb-form tolerance: scheduler ↔ scheduling, scheduler ↔ schedule
  if (token.endsWith("er") && haystack.includes(token.slice(0, -2) + "ing")) return true;
  if (token.endsWith("er") && haystack.includes(token.slice(0, -2))) return true;
  if (token.endsWith("ing") && haystack.includes(token.slice(0, -3))) return true;
  return false;
}

function isRelevant(keyword: string, r: { title?: string; content?: string }): boolean {
  const needle = keyword.toLowerCase().trim();
  if (!needle) return false;
  const haystack = `${r.title ?? ""} ${r.content ?? ""}`.toLowerCase();

  // Exact phrase wins immediately.
  if (haystack.includes(needle)) return true;

  // Multi-word fallback: all meaningful tokens (length > 2, not stopwords)
  // must be present in some morphological form.
  const STOP = new Set(["the", "and", "for", "with", "from", "your", "you"]);
  const tokens = needle.split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (tokens.length < 2) return false; // single-word keywords need exact match
  return tokens.every((t) => tokenMatches(haystack, t));
}

export async function refreshKeyword(
  userId: string,
  keywordId: string,
  keyword: string,
  opts: RefreshOptions = {}
): Promise<RefreshResult> {
  const raw = await searchPublicAll(keyword, { limit: opts.limit ?? 50, t: opts.t ?? "week" });
  const results = raw.filter((r) => isRelevant(keyword, r));
  let newMatches = 0;
  const newMatchPosts: Array<{
    type: "post" | "comment";
    title: string | null;
    content: string | null;
    subreddit: string;
    author: string;
    url: string;
    createdUtc: Date;
  }> = [];

  for (const r of results) {
    const post = await prisma.redditPost.upsert({
      where: { redditId: r.id },
      create: {
        redditId: r.id,
        type: r.type,
        title: r.title ?? null,
        content: r.content ?? null,
        subreddit: r.subreddit,
        author: r.author,
        url: r.url,
        score: r.score,
        numComments: r.numComments ?? 0,
        createdUtc: r.createdUtc,
        isHistorical: false,
      },
      update: { score: r.score, numComments: r.numComments ?? 0 },
    });

    const existing = await prisma.match.findUnique({
      where: {
        userId_keywordId_redditPostId: {
          userId,
          keywordId,
          redditPostId: post.id,
        },
      },
    });

    if (!existing) {
      await prisma.match.create({
        data: { userId, keywordId, redditPostId: post.id, notified: true },
      });

      // Daily stat for today
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await prisma.dailyStats.upsert({
        where: { userId_keywordId_date: { userId, keywordId, date: today } },
        create: { userId, keywordId, date: today, count: 1 },
        update: { count: { increment: 1 } },
      });

      newMatches++;
      newMatchPosts.push({
        type: post.type as "post" | "comment",
        title: post.title,
        content: post.content,
        subreddit: post.subreddit,
        author: post.author,
        url: post.url,
        createdUtc: post.createdUtc,
      });
    }
  }

  await prisma.keyword.update({
    where: { id: keywordId },
    data: { lastCheckedAt: new Date() },
  });

  // Send instant email alerts for new matches if the user opted in. Skip
  // silently if Resend isn't configured — we never want refresh to 500
  // because email failed.
  if (newMatchPosts.length > 0 && process.env.RESEND_API_KEY) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, emailAlerts: true, instantAlerts: true },
      });
      if (user?.email && user.emailAlerts && user.instantAlerts) {
        const toEmail = newMatchPosts.slice(0, MAX_EMAILS_PER_REFRESH);
        for (const p of toEmail) {
          try {
            await sendMatchAlert({
              userEmail: user.email,
              userName: user.name,
              keyword,
              postTitle: p.title ?? undefined,
              postContent: p.content ?? undefined,
              subreddit: p.subreddit,
              author: p.author,
              url: p.url,
              type: p.type,
              createdUtc: p.createdUtc,
            });
          } catch (err) {
            console.error(`[live-fetch] email send failed for ${p.url}:`, err);
          }
        }
        if (newMatchPosts.length > toEmail.length) {
          console.log(
            `[live-fetch] squelched ${newMatchPosts.length - toEmail.length} extra emails for "${keyword}"`
          );
        }
      }
    } catch (err) {
      console.error(`[live-fetch] alert dispatch failed for "${keyword}":`, err);
    }
  }

  return { keyword, fetched: results.length, newMatches };
}

export async function refreshAllActiveKeywords(
  userId: string,
  opts: RefreshOptions = {}
): Promise<RefreshResult[]> {
  const keywords = await prisma.keyword.findMany({
    where: { userId, active: true },
  });
  const results: RefreshResult[] = [];
  // Run sequentially to keep us under Reddit's ~10 req/min unauthenticated cap
  // (each keyword issues 2 requests — posts + comments — so 10 keywords = 20 reqs).
  for (const kw of keywords) {
    try {
      results.push(await refreshKeyword(userId, kw.id, kw.keyword, opts));
    } catch (err) {
      console.error(`[live-fetch] keyword "${kw.keyword}" failed:`, err);
      results.push({ keyword: kw.keyword, fetched: 0, newMatches: 0 });
    }
    // small spacing — be polite
    await new Promise((r) => setTimeout(r, 350));
  }
  return results;
}
