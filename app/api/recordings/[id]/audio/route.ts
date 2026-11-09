import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { audioFile, openAudioReadStream } from "@/lib/audioStore";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const FULL = "bytes";

/**
 * GET：回放原始音频。
 * 支持 Range 分段——iOS Safari 的 <audio> 必须先发 Range 探测，只返回整段会导致拖不动进度条。
 *
 * 这里按需从磁盘读一段，不再把整个文件读进内存：2 小时的录音有 100MB 以上，
 * 而播放器拖一次进度条就发一次 Range 请求，整读会反复制造上百 MB 的内存峰值。
 */
export async function GET(request: Request, { params }: Ctx) {
  const file = audioFile(params.id);
  if (!file) {
    return NextResponse.json({ error: "这条记录没有保存音频" }, { status: 404 });
  }

  const total = file.bytes;
  const contentType = file.mimeType || "audio/webm";

  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": FULL,
    // 音频不会变，但别让代理缓存到全局
    "Cache-Control": "private, max-age=3600",
  });

  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", String(total));
    return new NextResponse(bodyOf(file, 0, total - 1), { status: 200, headers });
  }

  const parsed = parseRange(range, total);
  if (!parsed) {
    // 语法不认识就退回整段，别让播放器一直转圈
    headers.set("Content-Length", String(total));
    return new NextResponse(bodyOf(file, 0, total - 1), { status: 200, headers });
  }

  if (parsed === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${total}`);
    return new NextResponse(null, { status: 416, headers });
  }

  const { start, end } = parsed;
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(end - start + 1));

  return new NextResponse(bodyOf(file, start, end), { status: 206, headers });
}

/** 磁盘文件 → Web ReadableStream。空文件返回 null，避免给播放器一个坏流 */
function bodyOf(
  file: NonNullable<ReturnType<typeof audioFile>>,
  start: number,
  end: number,
): ReadableStream<Uint8Array> | null {
  if (file.bytes === 0) return null;
  const nodeStream = openAudioReadStream(file, start, Math.min(end, file.bytes - 1));
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

/** 只处理单区间（播放器实际只会发这种），不合法返回 null，越界返回 unsatisfiable */
function parseRange(
  raw: string,
  total: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;

  if (!rawStart) {
    // bytes=-500 → 最后 500 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end >= total) end = total - 1;
  }

  if (!Number.isFinite(start) || start < 0 || start > end || start >= total) {
    return "unsatisfiable";
  }

  return { start, end };
}
