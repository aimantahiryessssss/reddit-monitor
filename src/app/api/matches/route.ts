import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  intentScore, HIGH_INTENT_THRESHOLD,
  brandRelevanceScore, BRAND_RELEVANCE_THRESHOLD,
} from "@/lib/relevance";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const keywordId = searchParams.get("keywordId");
  const type = searchParams.get("type"); // "live" | "historical"
  // intent filter:
  //  - "high"  → generic buyer-intent (questions, comparisons, recommendations)
  //  - "brand" → posts genuinely discussing the tracked keyword as a brand
  //              (reviews, comparisons, decisions, complaints — not drive-by
  //              mentions). Uses the per-match keyword string as the brand.
  //  - omitted/all → no filtering
  const intent = searchParams.get("intent");
  // Optional free-text description of the user's product. When provided AND
  // intent === "brand", the brand-relevance scorer requires the post to
  // share vocabulary with this description before letting it through —
  // filtering out posts that contain the brand string but aren't actually
  // about a tool in this category.
  const context = (searchParams.get("context") ?? "").slice(0, 400);
  const skip = (page - 1) * limit;

  const since = searchParams.get("since"); // "today" | undefined
  const kind = searchParams.get("kind");   // "post" | "comment" | undefined → only filter posts when "post"
  const where: any = { userId: session.user.id };
  if (keywordId) where.keywordId = keywordId;
  if (type === "historical") where.redditPost = { isHistorical: true };
  if (type === "live") where.redditPost = { isHistorical: false };
  if (kind === "post" || kind === "comment") {
    where.redditPost = { ...(where.redditPost ?? {}), type: kind };
  }
  if (since === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    where.redditPost = { ...(where.redditPost ?? {}), createdUtc: { gte: start } };
  }

  // When the user wants intent-filtered results, we have to over-fetch and
  // filter in JS because the score is computed from title+body+subreddit and
  // can't be expressed cleanly as a Prisma WHERE clause. Pull up to 5× the
  // requested page so we have enough candidates after filtering.
  const needsFilter = intent === "high" || intent === "brand";
  const overFetch = needsFilter ? Math.min(limit * 5, 200) : limit;

  const [rawMatches, totalAll] = await Promise.all([
    prisma.match.findMany({
      where,
      include: {
        keyword: { select: { keyword: true } },
        redditPost: true,
      },
      // Sort by when the Reddit POST was created, not when we imported the
      // match — that way "Hot Now" surfaces the freshest Reddit content,
      // not just the most recently-refreshed batch.
      orderBy: { redditPost: { createdUtc: "desc" } },
      skip: needsFilter ? 0 : skip,
      take: needsFilter ? overFetch : limit,
    }),
    prisma.match.count({ where }),
  ]);

  let matches = rawMatches;
  let total = totalAll;

  if (intent === "high") {
    const scored = rawMatches
      .map((m) => ({
        m,
        score: intentScore({
          title: m.redditPost.title,
          content: m.redditPost.content,
          subreddit: m.redditPost.subreddit,
        }),
      }))
      .filter((s) => s.score >= HIGH_INTENT_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    matches = scored.slice(skip, skip + limit).map((s) => s.m);
    // total here reflects the count *after* filtering the over-fetched batch;
    // it's an approximation, not a perfect count across the whole DB.
    total = scored.length;
  } else if (intent === "brand") {
    const scored = rawMatches
      .map((m) => ({
        m,
        score: brandRelevanceScore(
          {
            title: m.redditPost.title,
            content: m.redditPost.content,
            subreddit: m.redditPost.subreddit,
          },
          m.keyword.keyword,
          context || undefined,
        ),
      }))
      .filter((s) => s.score >= BRAND_RELEVANCE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    matches = scored.slice(skip, skip + limit).map((s) => s.m);
    total = scored.length;
  }

  // rawTotal = number of matches in the DB before intent filtering.
  // total    = number that survived the filter (may equal rawTotal if no filter).
  // Surfacing both lets the UI explain "showing 10 of 47 (37 dropped by filter)".
  return NextResponse.json({ matches, total, rawTotal: totalAll, page, limit, intent: intent ?? "all" });
}
