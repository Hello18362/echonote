import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dropAudio, putAudioStream } from "@/lib/audioStore";
import { buildOrderBy, buildWhere, queryFromSearchParams } from "@/lib/query";
import { recoverStuckRecordings } from "@/lib/recover";
import { parseStringArray, type RecordingListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 单个音频的体积上限，默认 200MB。
 * 想改就设 MAX_UPLOAD_MB，不用改代码。
 * 注意：上传会把整个文件读进内存做一次拷贝，所以上限开得越大，
 * 峰值内存也越大（200MB 大约要 400MB 上下）。这台机器日常够用。
 */
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 200) || 200);
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
/** multipart 每段都有边界和头，留 2MB 余量，别让正常请求被误杀 */
const MULTIPART_SLACK = 2 * 1024 * 1024;

/**
 * 手机上传的文件经常没有 MIME type（尤其安卓文件管理器、iOS「文件」App），
 * 只靠 audio.type 会一律当成 webm，转写时扩展名对不上。这里用扩展名兜底。
 */
function mimeOf(file: File): string {
  if (file.type) return file.type;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    webm: "audio/webm",
    amr: "audio/amr",
    "3ga": "audio/amr",
    "3gp": "audio/mp4",
    caf: "audio/x-caf",
  };

  return byExt[ext] ?? "audio/webm";
}

/**
 * GET：返回记录列表
 * 支持 ?q=关键词 &status=all|processing|done|error &sort=new|old|long|short
 */
export async function GET(request: Request) {
  try {
    // 顺手把上次进程遗留的「处理中」记录修好，否则列表上永远是转不完的圈
    await recoverStuckRecordings();

    const url = new URL(request.url);
    const query = queryFromSearchParams(url.searchParams);

    const rows = await prisma.recording.findMany({
      where: buildWhere(query),
      orderBy: buildOrderBy(query),
      select: {
        id: true,
        title: true,
        duration: true,
        status: true,
        summary: true,
        error: true,
        mock: true,
        tags: true,
        createdAt: true,
      },
    });

    const items: RecordingListItem[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      duration: r.duration,
      status: r.status as RecordingListItem["status"],
      summary: r.summary ?? "",
      error: r.error ?? null,
      mock: r.mock,
      tags: parseStringArray(r.tags),
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error("[api] 列表获取失败", err);
    return NextResponse.json({ error: "读取列表失败" }, { status: 500 });
  }
}

/** POST：创建记录（FormData：audio + duration），音频落盘以便重试 */
export async function POST(request: Request) {
  try {
    // 先看 Content-Length：超限就在读体之前拒绝。
    // 否则 formData() 会先把整个请求读进内存，200MB 的文件拒了也白占一大块。
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BYTES + MULTIPART_SLACK) {
      return NextResponse.json(
        { error: `音频文件超过 ${MAX_UPLOAD_MB}MB，请压缩后再上传` },
        { status: 413 },
      );
    }

    const form = await request.formData();
    const audio = form.get("audio");
    const durationRaw = form.get("duration");
    const duration = Number(durationRaw ?? 0);
    const safeDuration = Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0;

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "缺少音频文件" }, { status: 400 });
    }

    // 兜底：Content-Length 可能缺失（分块传输），这里再按实际长度判一次
    if (audio.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `音频文件超过 ${MAX_UPLOAD_MB}MB，请压缩后再上传` },
        { status: 413 },
      );
    }

    if (safeDuration <= 0) {
      return NextResponse.json({ error: "录音时长为 0，无法提交" }, { status: 400 });
    }

    const created = await prisma.recording.create({
      data: {
        title: "未命名录音",
        duration: safeDuration,
        status: "pending",
      },
      select: { id: true },
    });

    try {
      // 直接从请求流写到磁盘：200MB 的文件不再在内存里额外复制两份
      await putAudioStream(created.id, audio.stream(), mimeOf(audio));
    } catch (err) {
      // 音频没落盘就不要留一条永远转不了的记录，否则首页会出现点不开的空卡片
      await prisma.recording.delete({ where: { id: created.id } }).catch(() => {});
      dropAudio(created.id);
      throw err;
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    console.error("[api] 创建记录失败", err);
    return NextResponse.json({ error: "创建记录失败" }, { status: 500 });
  }
}

/**
 * DELETE：批量删除
 * body: { ids: string[] }
 * 不存在的 id 会被忽略，返回实际删除数量。
 */
export async function DELETE(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const rawIds = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: "请提供要删除的 ids" }, { status: 400 });
    }

    // 上限保护：一次最多 200 条
    const ids = Array.from(
      new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0)),
    ).slice(0, 200);
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids 中没有合法值" }, { status: 400 });
    }

    const result = await prisma.recording.deleteMany({ where: { id: { in: ids } } });

    // 数据库删成功后再清音频，避免库与文件不一致
    ids.forEach((id) => dropAudio(id));

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    console.error("[api] 批量删除失败", err);
    return NextResponse.json({ error: "批量删除失败" }, { status: 500 });
  }
}
