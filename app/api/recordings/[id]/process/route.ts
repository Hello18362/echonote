import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPipeline, isProcessing, type PipelineStage } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: { id: string } };

/**
 * POST：触发处理，立即返回 202，处理在后台异步执行
 * ?force=1        用于「重新处理」：即使已经 done 也重跑一遍（配置好模型后需要）
 * ?stage=summary  只重跑摘要：跳过转写，用现有逐字稿重新生成纪要（换模型时省额度）
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const search = new URL(request.url).searchParams;
    const force = search.get("force") === "1";
    const stage: PipelineStage = search.get("stage") === "summary" ? "summary" : "full";

    const record = await prisma.recording.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, transcript: true },
    });

    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    if (isProcessing(params.id)) {
      return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
    }

    if (stage === "summary") {
      // 没有逐字稿就没什么可总结的，直接告诉前端，别让它等一个必然失败的任务
      if (!(record.transcript ?? "").trim()) {
        return NextResponse.json(
          { error: "这条记录还没有逐字稿，只能整条重新处理" },
          { status: 400 },
        );
      }
    } else if (!force && record.status === "done") {
      // 已经完成的记录，没有 force 就跳过（幂等）
      return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
    }

    // 这里以前还有一条「状态是 transcribing/summarizing 就直接 202 跳过」。
    // 那个判断是错的：真正在跑的任务上一行已经用 isProcessing 挡掉了，
    // 走到这里的「处理中」只可能是上次进程崩溃留下的僵尸状态 ——
    // 用户点「重新处理」会被永远跳过，只能等 10 分钟超时扫描来救。
    // 直接放行，让流水线自己把状态改回 transcribing。

    // 异步执行，不阻塞响应
    void runPipeline(params.id, stage);

    return NextResponse.json({ ok: true, stage }, { status: 202 });
  } catch (err) {
    console.error("[api] 触发处理失败", err);
    return NextResponse.json({ error: "触发处理失败" }, { status: 500 });
  }
}
