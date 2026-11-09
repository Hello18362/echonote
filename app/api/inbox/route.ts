import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { INBOX_DIR, inboxPending, inboxReady, scanInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * 收件箱：把录音文件丢进这个文件夹，网站自己认出来并开始转写。
 *
 * GET  看路径、还有几个文件没导入
 * POST { action: "scan" } 立刻扫一遍
 * POST { action: "open" } 在资源管理器里打开这个文件夹
 *
 * 路径完全由服务端决定（INBOX_DIR），不接受前端传入，
 * 否则这里就成了「拿网页打开任意目录」的口子。
 */
export async function GET() {
  return NextResponse.json({
    dir: INBOX_DIR,
    ready: inboxReady(),
    pending: inboxPending(),
  });
}

export async function POST(request: Request) {
  let action = "scan";
  try {
    const body = (await request.json()) as { action?: unknown };
    if (typeof body.action === "string") action = body.action;
  } catch {
    // 没带 body 就按默认的 scan 处理
  }

  if (action === "open") {
    if (!inboxReady()) {
      return NextResponse.json({ error: "收件箱目录创建失败" }, { status: 500 });
    }
    try {
      // 走 explorer 而不是 shell.openPath：后者需要额外依赖，而且打不开时报错更含糊
      execFile("explorer.exe", [INBOX_DIR], { timeout: 5000 }, () => {
        // explorer 成功时也可能返回非 0，这里不看退出码
      });
      return NextResponse.json({ ok: true, dir: INBOX_DIR });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "打开文件夹失败" },
        { status: 500 },
      );
    }
  }

  try {
    const result = await scanInbox(true);
    return NextResponse.json({
      ok: true,
      dir: result.dir,
      imported: result.imported,
      failed: result.failed,
      pending: inboxPending(),
    });
  } catch (err) {
    console.error("[api] 扫描收件箱失败", err);
    return NextResponse.json({ error: "扫描收件箱失败" }, { status: 500 });
  }
}
