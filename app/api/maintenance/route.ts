import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { orphanAudio, pruneAudio } from "@/lib/audioStore";

export const dynamic = "force-dynamic";

/** GET：看一眼有没有孤儿音频（磁盘上有、数据库里已经没有对应记录） */
export async function GET() {
  try {
    const rows = await prisma.recording.findMany({ select: { id: true } });
    return NextResponse.json({ orphan: orphanAudio(rows.map((r) => r.id)) });
  } catch (err) {
    console.error("[api] 统计孤儿音频失败", err);
    return NextResponse.json({ error: "统计失败" }, { status: 500 });
  }
}

/**
 * POST：清理孤儿音频
 * body { action: "prune-audio" }
 *
 * 正常删除记录会顺带清音频，这个入口是给两种情况兜底的：
 * 1. 删除时文件被浏览器占用（Windows 上会 EPERM），没删干净；
 * 2. 手动改过数据库 / 直接从旧备份恢复过 dev.db。
 */
export async function POST(request: Request) {
  try {
    let action = "";
    try {
      const body = (await request.json()) as { action?: unknown };
      action = typeof body?.action === "string" ? body.action : "";
    } catch {
      // 没带 body 时按默认动作处理
    }

    if (action !== "prune-audio") {
      return NextResponse.json({ error: "不认识的操作" }, { status: 400 });
    }

    const rows = await prisma.recording.findMany({ select: { id: true } });
    const result = pruneAudio(rows.map((r) => r.id));

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api] 清理孤儿音频失败", err);
    return NextResponse.json({ error: "清理失败" }, { status: 500 });
  }
}
