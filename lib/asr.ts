/**
 * 语音识别抽象层：未配置服务时自动降级为 Mock。
 */
import { getAppConfig, isProviderReady, type ProviderConfig } from "./config";

const MOCK_TRANSCRIPT = `【演示数据 · 与你的录音无关】
当前未配置语音识别服务，以下内容是内置示例，不是本次录音的转写结果。

张伟：各位早上好，我们开始今天的项目周会。先同步一下进度。上周我们定下三件事：第一，把登录流程的埋点补齐；第二，修复移动端详情页在 iOS 上白屏的问题；第三，准备新版本的上线材料。李娜先说一下埋点的进展。
李娜：埋点这块，登录流程一共十二个事件，我已经补了九个，剩下三个卡在风控那边，他们要确认手机号验证那一步的事件命名。我本周三之前会跟风控对齐，对齐完当天就能补齐。另外我发现注册页有个埋点重复上报，已经提交了修复。
张伟：好，那个重复上报的问题严重吗？
李娜：不严重，数据量上会虚高百分之十左右，不影响主漏斗的结论，但还是要修。修复我今天下班前能合并。
王强：我这边说下白屏的问题。定位到了，是详情页在 iOS Safari 上用了新的 Intersection Observer 写法，低版本不支持，导致首屏渲染直接中断。我已经改成兜底方案，本地验证通过，但需要真机再测一轮，特别是 iPhone 12 及以下机型。明天我会借测试机跑一遍。
张伟：行，真机测完在群里同步结果。上线材料谁在跟？
王强：我在跟。release note 初稿写完了，还差两件事：一是运营那边要补一段新功能的推广文案，二是设计要出三张新版本的截图。我催一下，最迟周四收齐。另外我建议这次发版走灰度，先放百分之十，观察二十四小时没有异常再全量。
张伟：同意灰度。那时间点怎么定？
李娜：如果埋点周三补齐、真机测试周四出结果，我建议下周一提测，周三灰度，周五视数据全量。这样留了缓冲。
张伟：可以，就这么定。还有别的事吗？
王强：有个小的，我们监控告警的阈值太灵敏了，凌晨经常误报，把大家吵醒。建议把错误率的告警阈值从百分之零点五调到百分之一，并且加一个连续五分钟的判定条件。
张伟：这个提议好，王强你来改一下告警规则，改完在文档里说明一下调整原因。李娜，你把这次会议的待办整理一份发到群里。
李娜：没问题，我会在今天下班前发出去，并且把每一项的责任人和截止时间都标清楚。
张伟：好，那今天会议就到这里。下周同一时间我们再同步灰度的数据表现。`;

/** 单次转写请求的超时。2 小时的录音上游也要跑几分钟，给足余量但不能无限等 */
const ASR_TIMEOUT_MS = 15 * 60 * 1000;

/** 真实 ASR 调用（OpenAI 兼容 /audio/transcriptions） */
async function realTranscribe(
  file: Buffer,
  mimeType: string,
  cfg: ProviderConfig,
): Promise<string> {
  const base = cfg.baseUrl;
  const model = cfg.model;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(file)], { type: mimeType || "audio/webm" });
  form.append("file", blob, `audio.${extOf(mimeType)}`);
  form.append("model", model);

  let res: Response;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      // 没有超时的话，上游卡住会让这条记录永远停在「转写中」，
      // 而且 inflight 标记不清，用户点重新处理也会被当成「正在跑」跳过
      signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("语音识别超时（15 分钟没有返回），可稍后点「重新处理」重试");
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`ASR 调用失败：${res.status} ${await safeText(res)}${hintOf(res.status)}`);
  }

  const data = (await res.json()) as { text?: string };
  if (!data.text) throw new Error("ASR 返回内容为空");
  return data.text;
}

function extOf(mimeType: string): string {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("flac")) return "flac";
  if (mimeType.includes("aac")) return "m4a";
  if (mimeType.includes("amr")) return "amr";
  return "webm";
}

/** 把常见的状态码翻译成可执行的下一步，避免只看到一串 JSON */
function hintOf(status: number): string {
  switch (status) {
    case 400:
      return "（音频格式可能不被该服务接受，可先转成 mp3/wav 再用上传入口）";
    case 401:
    case 403:
      return "（Key 无效或没有语音识别权限）";
    case 404:
      return "（模型名不对，或该服务不提供 /audio/transcriptions）";
    case 413:
      return "（音频文件超出该服务的体积上限）";
    case 429:
      return "（调用频率或额度超限，稍后再试）";
    default:
      return "";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * 转写音频。file 为 null（v1 未持久化音频）时直接走 Mock。
 * 真实调用失败会重试 1 次，仍失败则抛错。
 */
export async function transcribe(
  file: Buffer | null,
  mimeType?: string,
): Promise<string> {
  const cfg = await getAppConfig();

  if (!isProviderReady(cfg.asr) || !file) {
    // Mock 模式下给一点延迟，让进度动画可见
    await delay(1600);
    return MOCK_TRANSCRIPT;
  }

  try {
    return await realTranscribe(file, mimeType || "audio/webm", cfg.asr);
  } catch (err) {
    console.error("[asr] 第一次调用失败，重试中", err);
    await delay(800);
    return await realTranscribe(file, mimeType || "audio/webm", cfg.asr);
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
