import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeTags } from "@/lib/types";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** 一次最多导入多少条，避免误传超大文件把服务卡住 */
const MAX_ITEMS = 500;

const VALID_STATUS = new Set(["pending", "transcribing", "summarizing", "done", "error"]);

type ImportRow = {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  transcript?: unknown;
  summary?: unknown;
  todos?: unknown;
  todosDone?: unknown;
  keyPoints?: unknown;
  tags?: unknown;
  edited?: unknown;
  status?: unknown;
  error?: unknown;
  mock?: unknown;
  createdAt?: unknown;
};

function str(value: unknown, max = 200_000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function strList(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, max);
}

function safeId(value: unknown): string {
  if (typeof value !== "string") return randomUUID();
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned.length >= 8 ? cleaned : randomUUID();
}

function parseDate(value: unknown): Date {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * POST /api/import
 * body：与 /api/export?format=json 完全相同的结构
 * ?mode=skip 时只补充不存在的记录，不覆盖已有的
 *
 * 只恢复文字内容——备份里不含音频，所以导入后无法「重新处理」。
 */
export async function POST(request: Request) {
  try {
    const mode = new URL(request.url).searchParams.get("mode") === "skip" ? "skip" : "upsert";

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "文件不是合法 JSON" }, { status: 400 });
    }

    const rows = (body as { recordings?: unknown })?.recordings;
    if (!Array.isArray(rows)) {
      return NextResponse.json(
        { error: "这个文件不是 EchoNote 的备份（缺少 recordings 字段）" },
        { status: 400 },
      );
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "备份里没有任何记录" }, { status: 400 });
    }
    if (rows.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `一次最多导入 ${MAX_ITEMS} 条，请分批导入` },
        { status: 413 },
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of rows as ImportRow[]) {
      const id = safeId(raw?.id);
      const status = VALID_STATUS.has(String(raw?.status)) ? String(raw?.status) : "done";

      const durationRaw = Number(raw?.duration);
      const duration = Number.isFinite(durationRaw)
        ? Math.max(0, Math.floor(durationRaw))
        : 0;

      const existing = await prisma.recording.findUnique({
        where: { id },
        select: { id: true },
      });

      if (existing && mode === "skip") {
        skipped++;
        continue;
      }

      // 处理中的记录导入后没有后台任务接着跑，直接标成失败，免得永远转圈
      const stuck = status === "pending" || status === "transcribing" || status === "summarizing";

      const doneRaw = Array.isArray(raw?.todosDone) ? raw.todosDone : [];
      const todos = strList(raw?.todos);

      const data: Prisma.RecordingUncheckedCreateInput = {
        id,
        title: str(raw?.title, 100).trim() || "未命名录音",
        duration,
        transcript: str(raw?.transcript),
        summary: str(raw?.summary, 20_000),
        todos: JSON.stringify(todos),
        // 备份里的勾选下标可能超出待办条数，裁掉才不会让进度环算出 5/3
        todosDone: JSON.stringify(
          doneRaw.filter(
            (i): i is number =>
              typeof i === "number" && Number.isInteger(i) && i >= 0 && i < todos.length,
          ),
        ),
        keyPoints: JSON.stringify(strList(raw?.keyPoints)),
        tags: JSON.stringify(normalizeTags(raw?.tags)),
        // 备份里带了「是否手动编辑过」，恢复后角标不该凭空消失
        edited: Boolean(raw?.edited),
        status: stuck ? "error" : status,
        error: stuck ? "从备份导入，原始音频不在备份中，可直接手动编辑或删除" : str(raw?.error, 500) || null,
        mock: Boolean(raw?.mock),
        createdAt: parseDate(raw?.createdAt),
      };

      if (existing) {
        await prisma.recording.update({
          where: { id },
          data: {
            title: data.title,
            duration: data.duration,
            transcript: data.transcript,
            summary: data.summary,
            todos: data.todos,
            todosDone: data.todosDone,
            keyPoints: data.keyPoints,
            tags: data.tags,
            edited: data.edited,
            status: data.status,
            error: data.error,
            mock: data.mock,
          },
        });
        updated++;
      } else {
        await prisma.recording.create({ data });
        created++;
      }
    }

    return NextResponse.json({ ok: true, created, updated, skipped, total: rows.length });
  } catch (err) {
    console.error("[api] 导入失败", err);
    return NextResponse.json({ error: "导入失败" }, { status: 500 });
  }
}
