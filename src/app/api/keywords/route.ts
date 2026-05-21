import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { backfillQueue } from "@/lib/queue";
import { refreshKeyword } from "@/lib/live-fetch";

const createSchema = z.object({
  keyword: z.string().min(2).max(100).trim(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keywords = await prisma.keyword.findMany({
    where: { userId: session.user.id },
    include: {
      _count: { select: { matches: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ keywords });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { keyword } = createSchema.parse(body);

    const count = await prisma.keyword.count({ where: { userId: session.user.id } });
    if (count >= 10) {
      return NextResponse.json({ error: "Maximum 10 keywords allowed" }, { status: 400 });
    }

    const existing = await prisma.keyword.findUnique({
      where: { userId_keyword: { userId: session.user.id, keyword: keyword.toLowerCase() } },
    });
    if (existing) {
      return NextResponse.json({ error: "Keyword already tracked" }, { status: 409 });
    }

    const kw = await prisma.keyword.create({
      data: { userId: session.user.id, keyword: keyword.toLowerCase() },
    });

    // Trigger historical backfill via BullMQ (real production path).
    // In preview mode this is a stubbed no-op — the inline fetch below covers it.
    await backfillQueue.add("backfill", {
      keywordId: kw.id,
      userId: session.user.id,
      keyword: kw.keyword,
    });

    // Inline live fetch using the public Reddit JSON endpoint (no credentials).
    // This is what makes "add a keyword → real matches appear immediately" work.
    try {
      const result = await refreshKeyword(session.user.id, kw.id, kw.keyword, { t: "month" });
      return NextResponse.json({ keyword: kw, fetched: result.fetched, newMatches: result.newMatches }, { status: 201 });
    } catch (err) {
      console.error("[keywords] inline fetch failed:", err);
      // Still return success — the keyword exists, just no live data yet
      return NextResponse.json({ keyword: kw, fetched: 0, newMatches: 0 }, { status: 201 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
