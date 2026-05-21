import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  emailAlerts: z.boolean().optional(),
  instantAlerts: z.boolean().optional(),
  digestEnabled: z.boolean().optional(),
  digestTime: z.string().optional(),
  timezone: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, email: true, image: true,
      emailAlerts: true, instantAlerts: true, digestEnabled: true,
      digestTime: true, timezone: true,
    },
  });

  return NextResponse.json({ user });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data = schema.parse(body);

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: {
        id: true, name: true, email: true,
        emailAlerts: true, instantAlerts: true, digestEnabled: true,
        digestTime: true, timezone: true,
      },
    });

    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
}
