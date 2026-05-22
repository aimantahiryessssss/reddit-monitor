import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { backfillQueue } from "@/lib/queue";
import { refreshKeyword } from "@/lib/live-fetch";

export const maxDuration = 60;

const createSchema = z.object({
  keyword: z.string().min(2).max(500).trim(),
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

    // Split on commas/newlines so the route accepts either a single keyword
    // ("hootsuite") or a bulk string ("hootsuite, buffer, sprout social").
    const items = Array.from(new Set(
      keyword.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(s => s.length >= 2 && s.length <= 100)
    ));
    if (items.length === 0) {
      return NextResponse.json({ error: "No valid keywords provided" }, { status: 400 });
    }

    const existingCount = await prisma.keyword.count({ where: { userId: session.user.id } });
    const slotsLeft = 10 - existingCount;
    if (slotsLeft <= 0) {
      return NextResponse.json({ error: "Maximum 10 keywords allowed" }, { status: 400 });
    }
    const toAdd = items.slice(0, slotsLeft);

    const added: Array<{ id: string; keyword: string }> = [];
    const skipped: string[] = [];

    for (const kwText of toAdd) {
      const existing = await prisma.keyword.findUnique({
        where: { userId_keyword: { userId: session.user.id, keyword: kwText } },
      });
      if (existing) { skipped.push(kwText); continue; }

      const kw = await prisma.keyword.create({
        data: { userId: session.user.id, keyword: kwText },
      });
      added.push({ id: kw.id, keyword: kw.keyword });

      await backfillQueue.add("backfill", {
        keywordId: kw.id,
        userId: session.user.id,
        keyword: kw.keyword,
      });

      try {
        await refreshKeyword(session.user.id, kw.id, kw.keyword, { t: "week", limit: 15 });
      } catch (err) {
        console.error(`[keywords] inline fetch failed for "${kw.keyword}":`, err);
      }
    }

    return NextResponse.json({
      added,
      skipped,
      truncated: items.length > toAdd.length,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
