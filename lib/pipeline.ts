import { prisma } from "./prisma";
import { transcribe } from "./asr";
import { summarize } from "./llm";
import { takeAudio } from "./audioStore";
import { getAppConfig, isProviderReady } from "./config";

/** 同一 id 同时只跑一条流水线，避免重复点击导致并发写入 */
const globalGuard = globalThis as unknown as { __echonote_inflight__?: Set<string> };
const inflight = (globalGuard.__echonote_inflight__ ??= new Set<string>());

export function isProcessing(id: string): boolean {
  return inflight.has(id);
}

/** full = 转写 + 总结；summary = 用现有逐字稿只重跑总结 */
export type PipelineStage = "full" | "summary";

/**
 * 处理主流程：pending → transcribing → summarizing → done
 * 任一步失败 → error
 * 音频已落盘，重新处理时能真正用回原音频（而不是退回演示数据）。
 */
export async function runPipeline(id: string, stage: PipelineStage = "full"): Promise<void> {
  if (inflight.has(id)) return;
  inflight.add(id);

  try {
    const record = await prisma.recording.findUnique({ where: { id } });
    if (!record) return;

    const cfg = await getAppConfig();

    let transcript = record.transcript ?? "";
    /** 只要有一环走的是内置示例（缺配置或没拿到音频），结果就不是真实转写 */
    let usedMock = record.mock;

    if (stage === "full") {
      // 1. 转写
      await prisma.recording.update({
        where: { id },
        data: { status: "transcribing", error: null },
      });

      const audio = takeAudio(id);
      usedMock = !isProviderReady(cfg.asr) || !isProviderReady(cfg.llm) || !audio;

      try {
        transcript = await transcribe(audio?.buffer ?? null, audio?.mimeType);
      } catch (err) {
        throw new Error(
          `转写失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await prisma.recording.update({
        where: { id },
        data: { transcript },
      });
    } else {
      // 只重跑总结：没有逐字稿就没有可总结的东西，直接报错比生成空摘要好
      if (!transcript.trim()) {
        throw new Error("这条记录还没有逐字稿，无法只重新生成摘要");
      }
      usedMock = record.mock || !isProviderReady(cfg.llm);
    }

    // 2. 总结
    await prisma.recording.update({
      where: { id },
      data: { status: "summarizing" },
    });

    let result;
    try {
      result = await summarize(transcript);
    } catch (err) {
      // 只重跑摘要时，用户手上那份摘要还能用，别拿降级文本把它盖掉
      if (stage === "summary") throw err;
      // 降级：摘要取逐字稿开头，todos / keyPoints 留空
      console.error("[pipeline] 总结失败，降级处理", err);
      result = {
        summary: `> 自动生成纪要失败，下面是逐字稿开头，仅供临时查看。可以点「只更新摘要」重试。\n\n${transcript.slice(0, 300)}…`,
        todos: [] as string[],
        keyPoints: [] as string[],
      };
    }

    await prisma.recording.update({
      where: { id },
      data: {
        summary: result.summary,
        todos: JSON.stringify(result.todos ?? []),
        // 待办重新生成后，旧的勾选下标已失效
        todosDone: "[]",
        keyPoints: JSON.stringify(result.keyPoints ?? []),
        status: "done",
        error: null,
        mock: usedMock,
        // 整条重跑等于换了一份 AI 产出，手动编辑标记失效；
        // 只重跑摘要时逐字稿没变，保留用户改过的痕迹
        ...(stage === "full" ? { edited: false } : {}),
      },
    });
  } catch (err) {
    console.error("[pipeline] 处理失败", err);
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.recording.update({
        where: { id },
        data: { status: "error", error: message.slice(0, 500) },
      });
    } catch (updateErr) {
      console.error("[pipeline] 写入 error 状态失败", updateErr);
    }
  } finally {
    inflight.delete(id);
  }
}
