import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAllMarkdown, safeFileName } from "@/lib/markdown";
import { formatDateTime, formatDuration } from "@/lib/format";
import { parseNumberArray, parseStringArray } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/export?format=json|md
 * - json：完整备份，含逐字稿 / 待办 / 关键词，可用于迁移或自行分析
 * - md  ：全部笔记合并成一份文档，带目录
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "md" ? "md" : "json";

    const rows = await prisma.recording.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        duration: true,
        transcript: true,
        summary: true,
        todos: true,
        todosDone: true,
        keyPoints: true,
        tags: true,
        edited: true,
        status: true,
        error: true,
        mock: true,
        createdAt: true,
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "md") {
      const md = buildAllMarkdown(
        rows.map((r) => ({
          title: safeFileName(r.title),
          createdAtLabel: formatDateTime(r.createdAt),
          durationLabel: formatDuration(r.duration),
          summary: r.summary ?? "",
          todos: parseStringArray(r.todos),
          todosDone: parseNumberArray(r.todosDone),
          keyPoints: parseStringArray(r.keyPoints),
          tags: parseStringArray(r.tags),
          transcript: r.transcript ?? "",
        })),
      );

      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="echonote-${stamp}.md"`,
        },
      });
    }

    const payload = {
      app: "EchoNote",
      version: 1,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      recordings: rows.map((r) => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        status: r.status,
        error: r.error,
        mock: r.mock,
        createdAt: r.createdAt.toISOString(),
        transcript: r.transcript ?? "",
        summary: r.summary ?? "",
        todos: parseStringArray(r.todos),
        todosDone: parseNumberArray(r.todosDone),
        keyPoints: parseStringArray(r.keyPoints),
        tags: parseStringArray(r.tags),
        edited: r.edited,
      })),
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="echonote-${stamp}.json"`,
      },
    });
  } catch (err) {
    console.error("[api] 导出失败", err);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
