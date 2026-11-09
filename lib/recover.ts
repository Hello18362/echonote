import { prisma } from "./prisma";
import { isProcessing } from "./pipeline";

/**
 * 处理流水线是「进程内异步任务」，进度只存在内存里。
 * 一旦服务重启 / 崩溃 / 热更新，内存里的任务就消失了，
 * 记录会永久停在 pending / transcribing / summarizing —— 用户看到的是一个转不完的圈。
 *
 * 这里做两件事：
 * 1. 进程启动后第一次访问接口时，把残留的非终态记录判为「被打断」；
 *    刚启动不可能有正在跑的任务，所以这个判断是安全的。
 * 2. 运行期间兜底：状态超过 STALE_MS 没变动、且不在内存任务表里，也判为被打断。
 *
 * 判为被打断的记录统一置为 error，用户可以在详情页点「重新处理」（音频已落盘）。
 */

/** 状态超过这么久没更新，视为卡死。长音频转写之间只有状态切换才写库，所以给足余量 */
const STALE_MS = 10 * 60 * 1000;

const ACTIVE_STATUSES = ["pending", "transcribing", "summarizing"] as const;

type RecoverGlobal = {
  __echonote_boot_recovered__?: boolean;
  __echonote_recover_running__?: Promise<number> | null;
  __echonote_recover_next__?: number;
};
const g = globalThis as unknown as RecoverGlobal;

/** 两个请求同时进来时只跑一轮，别各自查两遍库 */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** 进程内只跑一次启动扫描 */
async function runBootSweep(): Promise<number> {
  const rows = await prisma.recording.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    select: { id: true },
  });

  const victims = rows.filter((r) => !isProcessing(r.id));
  if (victims.length === 0) return 0;

  await prisma.recording.updateMany({
    where: { id: { in: victims.map((v) => v.id) } },
    data: {
      status: "error",
      error: "处理过程被中断（服务重启或页面关闭），录音已保存，可点击重新处理。",
    },
  });

  console.warn(`[recover] 启动扫描：${victims.length} 条记录停在处理中，已标记为可重试`);
  return victims.length;
}

/** 运行期兜底：只在接口被访问时顺带检查，无定时器 */
async function runStaleSweep(): Promise<number> {
  // 注意：不要用 Prisma 的 updatedAt 过滤。这个库的 DateTime 在 SQLite 里存的是 ISO 文本，
  // 而 Prisma 的 lt/gt 会把 Date 参数按整数绑定，比较结果恒为不匹配（实测返回 0 条）。
  // 非终态记录数量极少，直接全读出来在 JS 里比时间，稳且无方言依赖。
  const rows = await prisma.recording.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    select: { id: true, updatedAt: true },
  });

  const cutoff = Date.now() - STALE_MS;
  const victims = rows.filter(
    (r) => !isProcessing(r.id) && r.updatedAt.getTime() < cutoff,
  );
  if (victims.length === 0) return 0;

  await prisma.recording.updateMany({
    where: { id: { in: victims.map((v) => v.id) } },
    data: {
      status: "error",
      error: "处理超时未完成，录音已保存，可点击重新处理。",
    },
  });

  console.warn(`[recover] 超时扫描：${victims.length} 条记录处理超时`);
  return victims.length;
}

/**
 * 读取列表/详情前调用。任何异常都不能影响主流程，吞掉即可。
 * @returns 本次修正的记录数
 */
export async function recoverStuckRecordings(): Promise<number> {
  // 已经在跑了就复用同一轮结果，避免首页和接口同时触发两次全表扫描
  if (g.__echonote_recover_running__) return g.__echonote_recover_running__;

  const now = Date.now();
  const needBoot = !g.__echonote_boot_recovered__;
  // 运行期兜底 60 秒一次就够：它只处理「内存里没有、状态停在处理中」的遗留记录
  if (!needBoot && now < (g.__echonote_recover_next__ ?? 0)) return 0;

  const task = (async () => {
    let fixed = 0;
    try {
      if (needBoot) {
        g.__echonote_boot_recovered__ = true;
        fixed += await runBootSweep();
      }
      fixed += await runStaleSweep();
    } catch (err) {
      console.error("[recover] 恢复扫描失败", err);
    } finally {
      g.__echonote_recover_next__ = Date.now() + SWEEP_INTERVAL_MS;
      g.__echonote_recover_running__ = null;
    }
    return fixed;
  })();

  g.__echonote_recover_running__ = task;
  return task;
}
