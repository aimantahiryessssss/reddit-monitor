import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshAllActiveKeywords, refreshKeyword } from "@/lib/live-fetch";
import type { TimeRange } from "@/lib/reddit-public";

const VALID_RANGES: TimeRange[] = ["hour", "day", "week", "month", "year", "all"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const wipe = params.get("wipe") === "1";
  const keywordId = params.get("keywordId") ?? undefined;
  const tParam = params.get("t");
  const t: TimeRange | undefined = tParam && VALID_RANGES.includes(tParam as TimeRange)
    ? (tParam as TimeRange)
    : undefined;

  try {
    if (wipe) {
      const where = keywordId
        ? { userId: session.user.id, keywordId }
        : { userId: session.user.id };
      await prisma.match.deleteMany({ where });
      await prisma.dailyStats.deleteMany({ where });
    }

    // Per-keyword refresh: default to a full year of history when the user
    // explicitly asked for one keyword (that's the "show me everything" intent).
    // Global refresh: default to past month to stay polite on Reddit's
    // unauthenticated rate limit when sweeping all keywords.
    if (keywordId) {
      const kw = await prisma.keyword.findFirst({
        where: { id: keywordId, userId: session.user.id },
      });
      if (!kw) return NextResponse.json({ error: "Keyword not found" }, { status: 404 });

      const result = await refreshKeyword(session.user.id, kw.id, kw.keyword, {
        t: t ?? "year",
        limit: 100,
      });
      return NextResponse.json({
        ok: true,
        results: [result],
        totalNew: result.newMatches,
        totalFetched: result.fetched,
        wiped: wipe,
        scope: "keyword",
      });
    }

    const results = await refreshAllActiveKeywords(session.user.id, {
      t: t ?? "month",
      limit: 50,
    });
    const totalNew = results.reduce((sum, r) => sum + r.newMatches, 0);
    const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
    return NextResponse.json({ ok: true, results, totalNew, totalFetched, wiped: wipe, scope: "all" });
  } catch (err) {
    console.error("[api/live/refresh] error", err);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
