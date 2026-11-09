import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { dropAudio, putAudioStream } from "./audioStore";
import { prisma } from "./prisma";
import { runPipeline } from "./pipeline";

/**
 * 录音收件箱：把手机录的音丢进这个文件夹，网站自己认出来、入库、开始转写。
 *
 * 为什么要有它：手机录音进电脑这件事，绕不开「先把文件弄到电脑上」这一步；
 * 与其让人打开浏览器再点一遍上传，不如直接盯着文件夹 —— 微信传过来、
 * 数据线拷过来、AirDrop 过来，落在这个目录里就等于上传了。
 *
 * 两条硬规则：
 *   1. 文件大小/修改时间连续 3 秒没变才处理，否则可能读到只拷了一半的文件；
 *   2. 处理完把原件移到「已导入」子目录，不在原地留一份让人猜不透的重复文件。
 */

/** 收件箱位置。想放别处就设 INBOX_DIR，不用改代码 */
export const INBOX_DIR = process.env.INBOX_DIR
  ? path.resolve(process.env.INBOX_DIR)
  : path.join(process.cwd(), "录音收件箱");

const DONE_DIR = path.join(INBOX_DIR, "已导入");
const STATE_FILE = path.join(process.cwd(), "data", "inbox-state.json");

/** 常见录音格式。手机录音机/iOS 语音备忘录/微信导出基本落在这里面 */
const AUDIO_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  amr: "audio/amr",
  "3ga": "audio/amr",
  "3gp": "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  webm: "audio/webm",
  caf: "audio/x-caf",
  wma: "audio/x-ms-wma",
};

/** 拷到一半的临时文件 / 系统缩略图 / 下载未完成 */
const IGNORE = [
  /^~/,
  /^\./,
  /\.(tmp|part|crdownload|download|partial)$/i,
  /^(thumbs\.db|desktop\.ini)$/i,
];

const STABLE_MS = 3000;
const MIN_INTERVAL_MS = 4000;
/** 指纹表上限，超过就丢掉最老的——它只用来防「搬走失败后重复导入」 */
const STATE_MAX = 300;
/** 导入失败的文件先冷处理这么久，别每 25 秒建一条又删一条记录 */
const FAIL_RETRY_MS = 10 * 60 * 1000;

type State = { done: Record<string, number>; failed: Record<string, number> };

type Guard = {
  __echonote_inbox__?: {
    scanning: boolean;
    lastScan: number;
    queue: Promise<void>;
  };
};

const guard = (globalThis as unknown as Guard).__echonote_inbox__ ??= {
  scanning: false,
  lastScan: 0,
  queue: Promise.resolve(),
};

function readState(): State {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>;
    if (raw && typeof raw.done === "object" && raw.done) {
      return {
        done: raw.done,
        failed: raw.failed && typeof raw.failed === "object" ? raw.failed : {},
      };
    }
  } catch {
    // 没文件或文件坏了都当空表
  }
  return { done: {}, failed: {} };
}

function prune(map: Record<string, number>) {
  const keys = Object.keys(map);
  if (keys.length <= STATE_MAX) return;
  keys
    .sort((a, b) => map[a] - map[b])
    .slice(0, keys.length - STATE_MAX)
    .forEach((k) => delete map[k]);
}

function writeState(state: State) {
  prune(state.done);
  prune(state.failed);
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // 记不下来只是可能重复一次，不影响主流程
  }
}

export function inboxReady(): boolean {
  try {
    mkdirSync(DONE_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** 用 ffprobe 读时长；机器上没有就返回 0（列表显示 00:00，不影响转写） */
function probeDuration(file: string): number {
  const candidates = [
    process.env.FFPROBE_PATH,
    "ffprobe",
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffprobe.exe",
    ),
  ];
  for (const bin of candidates) {
    if (!bin) continue;
    try {
      const out = execFileSync(
        bin,
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
        { timeout: 15000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const n = Math.round(Number(String(out).trim()));
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      // 换下一个候选
    }
  }
  return 0;
}

function titleOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim();
  return (base || "未命名录音").slice(0, 120);
}

/**
 * 把文件挪进「已导入」。rename 跨盘会失败（EXDEV），再退到复制+删除；
 * 都失败就留在原地，靠指纹表压住重复导入。
 */
function archive(file: string, name: string): boolean {
  const target = path.join(DONE_DIR, name);
  try {
    renameSync(file, target);
    return true;
  } catch {
    try {
      copyFileSync(file, target);
      unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }
}

/** 转写排队：一次只跑一条，避免丢十个文件进去同时打上游接口 */
function enqueue(id: string) {
  guard.queue = guard.queue
    .then(() => runPipeline(id, "full"))
    .catch(() => {
      // runPipeline 自己会吞错并写 error 状态，这里只保证队列不断
    });
}

export type InboxResult = {
  dir: string;
  imported: Array<{ id: string; title: string; bytes: number }>;
  failed: Array<{ file: string; reason: string }>;
};

/**
 * 扫一遍收件箱。节流 4 秒，force 时不节流（用户点「立即扫描」）。
 */
export async function scanInbox(force = false): Promise<InboxResult> {
  const empty: InboxResult = { dir: INBOX_DIR, imported: [], failed: [] };

  if (!force && Date.now() - guard.lastScan < MIN_INTERVAL_MS) return empty;
  if (guard.scanning) return empty;
  guard.scanning = true;
  guard.lastScan = Date.now();

  try {
    if (!inboxReady()) {
      return { ...empty, failed: [{ file: INBOX_DIR, reason: "收件箱目录不可用" }] };
    }

    let names: string[] = [];
    try {
      names = readdirSync(INBOX_DIR);
    } catch {
      return empty;
    }

    const autoProcess = process.env.INBOX_AUTO_PROCESS !== "0";
    const state = readState();
    const result: InboxResult = { dir: INBOX_DIR, imported: [], failed: [] };

    for (const name of names) {
      if (IGNORE.some((re) => re.test(name))) continue;

      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = AUDIO_EXT[ext];
      if (!mime) continue;

      const file = path.join(INBOX_DIR, name);

      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size === 0) continue;

      // 还在写就别碰：拷贝中的文件大小会一直变
      if (Date.now() - st.mtimeMs < STABLE_MS) continue;

      const fingerprint = `${name}:${st.size}:${Math.round(st.mtimeMs)}`;
      if (state.done[fingerprint]) continue;

      // 刚失败过的文件先别碰：多半是文件被占用/磁盘满，25 秒后再来一遍
      // 只会不停建记录又删记录，日志也会被刷满
      const failedAt = state.failed[fingerprint];
      if (failedAt && Date.now() - failedAt < FAIL_RETRY_MS) continue;

      let createdId: string | null = null;
      try {
        const created = await prisma.recording.create({
          data: {
            title: titleOf(name),
            duration: probeDuration(file),
            status: "pending",
          },
          select: { id: true },
        });
        createdId = created.id;

        // 先入库再落音频：反了的话中途失败会留下没有记录的孤儿文件。
        // 用流而不是 readFileSync：手机录音动辄上百 MB，同步整读会把事件循环
        // 卡住一两秒（这期间网页所有请求都在排队），还多占一份内存。
        await putAudioStream(
          created.id,
          Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>,
          mime,
        );

        const moved = archive(file, name);
        state.done[fingerprint] = Date.now();
        delete state.failed[fingerprint];
        writeState(state);

        result.imported.push({ id: created.id, title: titleOf(name), bytes: st.size });
        if (autoProcess) enqueue(created.id);
        if (!moved) {
          result.failed.push({ file: name, reason: "已导入，但原文件没能移进「已导入」" });
        }
      } catch (err) {
        // 建了记录但音频没落盘 / 落盘失败：把这条空记录删掉。
        // 不删的话它会以 pending 状态永远留在首页，点开还没有音频；
        // 而且下一次扫描会再建一条，几轮下来全是幽灵记录。
        if (createdId) {
          try {
            await prisma.recording.delete({ where: { id: createdId } });
            dropAudio(createdId);
          } catch {
            // 删不掉就算了，至少下面会记进失败表，不会继续叠加
          }
        }
        state.failed[fingerprint] = Date.now();
        writeState(state);
        result.failed.push({
          file: name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  } finally {
    guard.scanning = false;
  }
}

/** 只数一下还有多少待处理，用于首页提示，不触发导入 */
export function inboxPending(): number {
  try {
    let n = 0;
    for (const name of readdirSync(INBOX_DIR)) {
      if (IGNORE.some((re) => re.test(name))) continue;
      if (!AUDIO_EXT[name.split(".").pop()?.toLowerCase() ?? ""]) continue;
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}
