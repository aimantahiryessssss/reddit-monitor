import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Trimmed to ONLY what the dashboard UI currently renders.
  // Previously this endpoint also computed per-keyword streaks (N+1 dailyStats
  // queries) and a recentMatches preview list (with includes) — both unused
  // by the page. Removing them cut dashboard load from ~12 queries to 6.
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    totalKeywords,
    activeKeywords,
    matchesToday,
    unreadMatches,
    dailyStats,
    topSubreddits,
    trendingKwStats,
  ] = await Promise.all([
    prisma.keyword.count({ where: { userId } }),
    prisma.keyword.count({ where: { userId, active: true } }),
    prisma.match.count({ where: { userId, createdAt: { gte: today } } }),
    prisma.match.count({ where: { userId, notified: false } }),
    prisma.dailyStats.findMany({
      where: { userId, date: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
      orderBy: { date: "asc" },
    }),
    prisma.redditPost.groupBy({
      by: ["subreddit"],
      where: { matches: { some: { userId } } },
      _count: { subreddit: true },
      orderBy: { _count: { subreddit: "desc" } },
      take: 5,
    }),
    prisma.match.groupBy({
      by: ["keywordId"],
      where: { userId, createdAt: { gte: last24h } },
      _count: { keywordId: true },
      orderBy: { _count: { keywordId: "desc" } },
      take: 1,
    }),
  ]);

  let trendingKeyword = "None";
  if (trendingKwStats.length > 0) {
    const kw = await prisma.keyword.findUnique({
      where: { id: trendingKwStats[0].keywordId },
      select: { keyword: true },
    });
    if (kw) trendingKeyword = kw.keyword;
  }

  const res = NextResponse.json({
    totalKeywords,
    activeKeywords,
    matchesToday,
    unreadMatches,
    dailyStats,
    topSubreddits: topSubreddits.map((s) => ({ subreddit: s.subreddit, count: s._count.subreddit })),
    trendingKeyword,
  });
  // Short browser cache so quick tab-switches don't re-hammer the DB.
  res.headers.set("Cache-Control", "private, max-age=20");
  return res;
}
