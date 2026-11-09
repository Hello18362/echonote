import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

/**
 * 音频落盘存储：data/audio/<id>.<ext> + <id>.json（记录 mime 与大小）
 * 落盘的意义是「重启后仍能重试」——之前只放内存，进程一重启音频就没了。
 * 音频会保留到对应记录被删除为止，方便随时重新处理。
 */

export type AudioPayload = { buffer: Buffer; mimeType: string };

const ROOT = path.join(process.cwd(), "data", "audio");

const EXT_BY_MIME: Array<[RegExp, string]> = [
  [/mp4|m4a|aac/, "m4a"],
  [/mpeg|mp3/, "mp3"],
  [/wav/, "wav"],
  [/ogg|opus/, "opus"],
  [/webm/, "webm"],
  [/flac/, "flac"],
  [/amr/, "amr"],
];

const MIME_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  webm: "audio/webm",
  flac: "audio/flac",
  amr: "audio/amr",
};

/** 只允许 uuid 类的字符，避免路径穿越 */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function extOf(mimeType: string): string {
  for (const [re, ext] of EXT_BY_MIME) if (re.test(mimeType)) return ext;
  return "webm";
}

function ensureRoot() {
  mkdirSync(ROOT, { recursive: true });
}

export type AudioFile = { path: string; ext: string; mimeType: string; bytes: number };

/**
 * 定位某个 id 的音频文件。
 * 转写要 buffer，播放要路径（按 Range 流式读），所以这里只扫一次目录，
 * 把路径和元信息一起给出去，别让调用方各自拼路径。
 */
export function audioFile(id: string): AudioFile | null {
  const key = safeId(id);
  if (!key) return null;

  let files: string[] = [];
  try {
    files = readdirSync(ROOT);
  } catch {
    return null;
  }

  const name = files.find((f) => f.startsWith(`${key}.`) && !f.endsWith(".json"));
  if (!name) return null;

  const filePath = path.join(ROOT, name);
  let bytes = 0;
  try {
    bytes = statSync(filePath).size;
  } catch {
    return null;
  }

  const ext = name.split(".").pop() ?? "";
  let mimeType = MIME_BY_EXT[ext] ?? "audio/webm";

  const metaFile = path.join(ROOT, `${key}.json`);
  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { mimeType?: string };
      if (meta.mimeType) mimeType = meta.mimeType;
    } catch {
      // meta 损坏不影响播放，用扩展名推断
    }
  }

  return { path: filePath, ext, mimeType, bytes };
}

export function takeAudio(id: string): AudioPayload | null {
  const file = audioFile(id);
  if (!file) return null;

  try {
    // 转写接口要的是完整音频，这里必须读全；调用完即释放
    return { buffer: readFileSync(file.path), mimeType: file.mimeType };
  } catch {
    return null;
  }
}

/**
 * 流式落盘。上传 200MB 的录音时，formData 已经占了一份内存，
 * 这里再 arrayBuffer() + Buffer.from 会再翻两倍，容易把进程顶到 OOM。
 * 直接把请求里的流灌到磁盘，峰值只有几十 KB 的 chunk。
 */
export async function putAudioStream(
  id: string,
  source: ReadableStream<Uint8Array>,
  mimeType: string,
): Promise<{ bytes: number; ext: string }> {
  const key = safeId(id);
  if (!key) throw new Error("非法的记录 id");

  ensureRoot();
  const ext = extOf(mimeType || "audio/webm");
  const filePath = path.join(ROOT, `${key}.${ext}`);

  try {
    await pipeline(
      Readable.fromWeb(source as unknown as import("node:stream/web").ReadableStream<Uint8Array>),
      createWriteStream(filePath),
    );
  } catch (err) {
    // 半截文件比没有文件更糟：下次重试会看到它，却解不开
    try {
      rmSync(filePath, { force: true });
    } catch {
      // 删不掉也没别的办法
    }
    throw err;
  }

  const bytes = statSync(filePath).size;
  writeFileSync(
    path.join(ROOT, `${key}.json`),
    JSON.stringify({
      mimeType: mimeType || MIME_BY_EXT[ext],
      bytes,
      savedAt: new Date().toISOString(),
    }),
  );

  return { bytes, ext };
}

/** 播放用：按需读一段（支持 Range），不把整段音频读进内存 */
export function openAudioReadStream(
  file: AudioFile,
  start?: number,
  end?: number,
): ReturnType<typeof createReadStream> {
  return createReadStream(file.path, start === undefined ? undefined : { start, end });
}

/** 只看是否存在与大小，不把整个文件读进内存（详情页 SSR 用） */
export function audioInfo(id: string): { exists: boolean; mimeType: string; bytes: number } {
  const file = audioFile(id);
  if (!file) return { exists: false, mimeType: "", bytes: 0 };
  return { exists: true, mimeType: file.mimeType, bytes: file.bytes };
}

export function dropAudio(id: string) {
  const key = safeId(id);
  if (!key) return;
  removeFiles(key);
}

/**
 * 删掉某个 key 名下的所有文件，单个失败不影响其他。
 *
 * Windows 上刚被读取/播放过的文件会有短暂句柄残留，rmSync 第一次可能抛 EPERM/EBUSY。
 * 这里的处理是三层：
 *   1. rmSync 自带 maxRetries + retryDelay（只对 EPERM/EBUSY/EMFILE 等生效，需 recursive 打开）
 *   2. 仍失败的收集起来，交给 scheduleRetry 在稍后补删两次
 *   3. 极端情况（进程重启前没删掉）由 maintenance 的孤儿清理兜底
 */
function removeFiles(key: string): { removed: number; failed: number } {
  let files: string[] = [];
  try {
    files = readdirSync(ROOT);
  } catch {
    // 目录还不存在，没有可清理的
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  const stuck: string[] = [];
  for (const f of files) {
    if (!f.startsWith(`${key}.`)) continue;
    try {
      rmSync(path.join(ROOT, f), {
        force: true,
        recursive: true,
        maxRetries: 5,
        retryDelay: 40,
      });
      removed++;
    } catch (err) {
      // 以前这里一个失败就跳出整轮循环，导致同一记录的音频全留在磁盘上
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // 已经被别处删掉了，按成功算
        removed++;
      } else {
        stuck.push(f);
        console.warn("[audioStore] 音频删除受阻，稍后重试", f, code ?? err);
      }
    }
  }

  if (stuck.length > 0) scheduleRetry(stuck);
  return { removed, failed: stuck.length };
}

/** 失败文件的后台补删：400ms 一次、2.5s 一次，还不成就交给孤儿清理 */
const pendingRetry = new Set<string>();

function scheduleRetry(files: string[]) {
  const todo = files.filter((f) => !pendingRetry.has(f));
  if (todo.length === 0) return;
  for (const f of todo) pendingRetry.add(f);

  const attempt = (left: string[], delay: number, again: boolean) => {
    const timer = setTimeout(() => {
      const still: string[] = [];
      for (const f of left) {
        try {
          rmSync(path.join(ROOT, f), {
            force: true,
            recursive: true,
            maxRetries: 3,
            retryDelay: 60,
          });
          pendingRetry.delete(f);
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
            pendingRetry.delete(f);
          } else {
            still.push(f);
          }
        }
      }
      if (still.length === 0) return;
      if (again) {
        attempt(still, 2100, false);
      } else {
        for (const f of still) pendingRetry.delete(f);
        console.error(
          "[audioStore] 音频文件仍无法删除，等待孤儿清理",
          still.join(", "),
        );
      }
    }, delay);
    // 别让补删任务拖住进程退出
    if (typeof timer.unref === "function") timer.unref();
  };

  attempt(todo, 400, true);
}

/** 列出磁盘上所有音频的 id（不含 .json 元数据），用于排查孤儿文件 */
export function listAudioKeys(): string[] {
  try {
    return readdirSync(ROOT)
      .filter((f) => !f.endsWith(".json"))
      .map((f) => f.replace(/\.[^.]+$/, ""));
  } catch {
    return [];
  }
}

/** 孤儿音频数量与占用（磁盘上有、数据库里已经没有对应记录） */
export function orphanAudio(keepIds: string[]): { count: number; bytes: number } {
  const keep = new Set(keepIds.map(safeId));
  let count = 0;
  let bytes = 0;

  for (const key of listAudioKeys()) {
    if (keep.has(key)) continue;
    count++;
    try {
      for (const f of readdirSync(ROOT)) {
        if (f.startsWith(`${key}.`)) bytes += statSync(path.join(ROOT, f)).size;
      }
    } catch {
      // 读不到大小就只计数
    }
  }

  return { count, bytes };
}

/**
 * 清理孤儿音频：给「删除时文件被占用」和「手动改过数据库」兜底。
 */
export function pruneAudio(keepIds: string[]): { removed: number; failed: number } {
  const keep = new Set(keepIds.map(safeId));
  let removed = 0;
  let failed = 0;

  for (const key of listAudioKeys()) {
    if (keep.has(key)) continue;
    const r = removeFiles(key);
    removed += r.removed;
    failed += r.failed;
  }

  return { removed, failed };
}

/** 磁盘占用概览，设置页用它展示「音频占用」 */
export function audioUsage(): { count: number; bytes: number } {
  try {
    const files = readdirSync(ROOT).filter((f) => !f.endsWith(".json"));
    let bytes = 0;
    for (const f of files) {
      try {
        bytes += statSync(path.join(ROOT, f)).size;
      } catch {
        // 单个文件读不到就跳过
      }
    }
    return { count: files.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
