import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStringArray } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** PUT：保存待办勾选状态，body: { done: number[] } */
export async function PUT(request: Request, { params }: Ctx) {
  let body: { done?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.done)) {
    return NextResponse.json({ error: "done 必须是数组" }, { status: 400 });
  }

  try {
    const record = await prisma.recording.findUnique({
      where: { id: params.id },
      select: { todos: true },
    });

    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const total = parseStringArray(record.todos).length;
    const done = Array.from(
      new Set(
        body.done.filter(
          (i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < total,
        ),
      ),
    ).sort((a, b) => a - b);

    await prisma.recording.update({
      where: { id: params.id },
      data: { todosDone: JSON.stringify(done) },
    });

    return NextResponse.json({ ok: true, done });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    console.error("[api] 保存待办状态失败", err);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
