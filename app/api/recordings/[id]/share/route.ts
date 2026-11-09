import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** 分享令牌：32 位十六进制，不可猜 */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

function payload(token: string | null) {
  return {
    shared: Boolean(token),
    token,
    path: token ? `/s/${token}` : null,
  };
}

/** GET：查询当前分享状态 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const record = await prisma.recording.findUnique({
      where: { id: params.id },
      select: { shareToken: true },
    });
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json(payload(record.shareToken));
  } catch (err) {
    console.error("[api] 读取分享状态失败", err);
    return NextResponse.json({ error: "读取分享状态失败" }, { status: 500 });
  }
}

/**
 * POST：开关分享
 * body { enabled: true }  → 没有令牌就生成一个，已有则沿用（旧链接继续有效）
 * body { enabled: false } → 撤销，旧链接立即失效
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    let enabled = true;
    try {
      const body = (await request.json()) as { enabled?: unknown };
      if (typeof body?.enabled === "boolean") enabled = body.enabled;
    } catch {
      // 没带 body 视为「开启」
    }

    const record = await prisma.recording.findUnique({
      where: { id: params.id },
      select: { shareToken: true },
    });
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    if (!enabled) {
      await prisma.recording.update({
        where: { id: params.id },
        data: { shareToken: null },
      });
      return NextResponse.json(payload(null));
    }

    const token = record.shareToken ?? newToken();
    if (!record.shareToken) {
      await prisma.recording.update({
        where: { id: params.id },
        data: { shareToken: token },
      });
    }

    return NextResponse.json(payload(token));
  } catch (err) {
    console.error("[api] 更新分享状态失败", err);
    return NextResponse.json({ error: "更新分享状态失败" }, { status: 500 });
  }
}
