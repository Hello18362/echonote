import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dropAudio } from "@/lib/audioStore";
import { recoverStuckRecordings } from "@/lib/recover";
import {
  normalizeTags,
  parseNumberArray,
  parseStringArray,
  type RecordingDetail,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Prisma 的「记录不存在」统一转成 404 */
function isNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  );
}

/** GET：单条完整记录 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    // 若这条记录是上次进程遗留的「处理中」，先修好再返回，避免前端一直轮询
    await recoverStuckRecordings();

    const record = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const detail: RecordingDetail = {
      id: record.id,
      title: record.title,
      duration: record.duration,
      status: record.status as RecordingDetail["status"],
      summary: record.summary ?? "",
      error: record.error ?? null,
      mock: record.mock,
      tags: parseStringArray(record.tags),
      createdAt: record.createdAt.toISOString(),
      transcript: record.transcript ?? "",
      todos: parseStringArray(record.todos),
      todosDone: parseNumberArray(record.todosDone),
      keyPoints: parseStringArray(record.keyPoints),
      edited: record.edited,
      shared: Boolean(record.shareToken),
    };

    return NextResponse.json(detail);
  } catch (err) {
    console.error("[api] 详情获取失败", err);
    return NextResponse.json({ error: "读取详情失败" }, { status: 500 });
  }
}

const LIMITS = {
  title: 100,
  summary: 20_000,
  transcript: 200_000,
  /** 待办 / 关键词：条数与单条长度 */
  items: 100,
  itemLength: 500,
} as const;

function fail(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function textField(
  value: unknown,
  label: string,
  max: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: `${label}必须是文本` };
  if (value.length > max) return { ok: false, message: `${label}超长（最多 ${max} 字）` };
  return { ok: true, value };
}

function listField(
  value: unknown,
  label: string,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) return { ok: false, message: `${label}必须是数组` };
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { ok: false, message: `${label}里有非文本项` };
    const item = raw.trim().slice(0, LIMITS.itemLength);
    if (!item) continue;
    out.push(item);
    if (out.length > LIMITS.items) {
      return { ok: false, message: `${label}最多 ${LIMITS.items} 条` };
    }
  }
  return { ok: true, value: out };
}

/**
 * PATCH：改标题与正文。
 * 支持 title / transcript / summary / todos / keyPoints / tags，
 * 任意正文改动都会把 edited 置 true（避免手动改过的内容被误认为 AI 原样输出）。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("请求体不是合法 JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("请求体格式不对");
    }

    const data: Prisma.RecordingUpdateInput = {};
    let touchedContent = false;

    if (body.title !== undefined) {
      const title = textField(body.title, "标题", LIMITS.title);
      if (!title.ok) return fail(title.message);
      const trimmed = title.value.trim();
      if (!trimmed) return fail("标题不能为空");
      data.title = trimmed;
    }

    if (body.transcript !== undefined) {
      const v = textField(body.transcript, "逐字稿", LIMITS.transcript);
      if (!v.ok) return fail(v.message);
      data.transcript = v.value;
      touchedContent = true;
    }

    if (body.summary !== undefined) {
      const v = textField(body.summary, "摘要", LIMITS.summary);
      if (!v.ok) return fail(v.message);
      data.summary = v.value;
      touchedContent = true;
    }

    let nextTodos: string[] | null = null;
    if (body.todos !== undefined) {
      const v = listField(body.todos, "待办");
      if (!v.ok) return fail(v.message);
      nextTodos = v.value;
      data.todos = JSON.stringify(v.value);
      touchedContent = true;
    }

    if (body.keyPoints !== undefined) {
      const v = listField(body.keyPoints, "关键词");
      if (!v.ok) return fail(v.message);
      data.keyPoints = JSON.stringify(v.value);
      touchedContent = true;
    }

    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) return fail("标签必须是数组");
      data.tags = JSON.stringify(normalizeTags(body.tags));
      // 标签属于元信息，不算「改过正文」，不点亮「已手动编辑」角标
    }

    if (Object.keys(data).length === 0) {
      return fail("没有要更新的内容");
    }

    // 待办条目变了，旧的勾选下标可能指向不存在的条目，按新长度裁剪
    if (nextTodos !== null) {
      const list = nextTodos;
      const current = await prisma.recording.findUnique({
        where: { id: params.id },
        select: { todosDone: true },
      });
      if (!current) {
        return NextResponse.json({ error: "记录不存在" }, { status: 404 });
      }
      const kept = parseNumberArray(current.todosDone).filter((i) => i < list.length);
      data.todosDone = JSON.stringify(kept);
    }

    if (touchedContent) {
      data.edited = true;
    }

    const updated = await prisma.recording.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        title: true,
        summary: true,
        transcript: true,
        todos: true,
        todosDone: true,
        keyPoints: true,
        tags: true,
        edited: true,
      },
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      summary: updated.summary ?? "",
      transcript: updated.transcript ?? "",
      todos: parseStringArray(updated.todos),
      todosDone: parseNumberArray(updated.todosDone),
      keyPoints: parseStringArray(updated.keyPoints),
      tags: parseStringArray(updated.tags),
      edited: updated.edited,
    });
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    console.error("[api] 更新记录失败", err);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

/** DELETE：删除记录 */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await prisma.recording.delete({ where: { id: params.id } });
    dropAudio(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    console.error("[api] 删除失败", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
