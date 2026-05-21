import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const keyword = await prisma.keyword.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!keyword) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.keyword.update({
    where: { id },
    data: {
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(body.keyword ? { keyword: body.keyword.toLowerCase() } : {}),
    },
  });

  return NextResponse.json({ keyword: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const keyword = await prisma.keyword.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!keyword) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.keyword.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
