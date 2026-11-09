import { NextResponse } from "next/server";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";
import { prisma } from "@/lib/prisma";
import { parseMarkdownBlocks, stripInline } from "@/lib/meetingNote";
import { formatDateTime, formatDuration } from "@/lib/format";
import { safeFileName } from "@/lib/markdown";
import { parseStringArray } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 字体：中文用雅黑，西文用等线体一类无衬线，和网页观感接近 */
const FONT = { ascii: "Segoe UI", eastAsia: "微软雅黑", hAnsi: "Segoe UI" };

const BODY_SIZE = 22; // 11pt
const SMALL_SIZE = 18; // 9pt
const HEADING_SIZE = 26; // 13pt
const TITLE_SIZE = 40; // 20pt

type InlineOpts = { size?: number; color?: string; bold?: boolean };

/** 把 **粗体** 拆成多个 run，其余原样 */
function inlineRuns(text: string, opts: InlineOpts = {}): TextRun[] {
  const { size = BODY_SIZE, color = "334155", bold = false } = opts;
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map(
    (part) =>
      new TextRun({
        text: part.startsWith("**") && part.endsWith("**") ? part.slice(2, -2) : part,
        bold: bold || (part.startsWith("**") && part.endsWith("**")),
        size,
        color: part.startsWith("**") && part.endsWith("**") ? "0F172A" : color,
        font: FONT,
      }),
  );
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0", space: 4 },
    },
    children: [
      new TextRun({
        text: stripInline(text),
        bold: true,
        size: HEADING_SIZE,
        color: "0F172A",
        font: FONT,
      }),
    ],
  });
}

function bodyPara(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 100, line: 320 },
    children: inlineRuns(text),
  });
}

function bullet(text: string, ordered: boolean, index: number): Paragraph {
  const marker = ordered ? `${index + 1}. ` : "• ";
  return new Paragraph({
    spacing: { after: 60, line: 320 },
    indent: { left: 360, hanging: 220 },
    children: [
      new TextRun({ text: marker, size: BODY_SIZE, color: "64748B", font: FONT }),
      ...inlineRuns(text),
    ],
  });
}

function buildTable(head: string[], rows: string[][]): Table {
  const widths = head.length === 3 ? [5200, 2000, 1800] : head.map(() => Math.floor(9000 / head.length));

  const headerRow = new TableRow({
    tableHeader: true,
    children: head.map(
      (h, i) =>
        new TableCell({
          width: { size: widths[i] ?? 2000, type: WidthType.DXA },
          shading: { fill: "F8FAFC" },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: stripInline(h),
                  bold: true,
                  size: SMALL_SIZE + 1,
                  color: "475569",
                  font: FONT,
                }),
              ],
            }),
          ],
        }),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cellText, i) =>
            new TableCell({
              width: { size: widths[i] ?? 2000, type: WidthType.DXA },
              margins: { top: 90, bottom: 90, left: 120, right: 120 },
              children: [
                new Paragraph({
                  spacing: { line: 300 },
                  children: inlineRuns(stripInline(cellText), {
                    size: SMALL_SIZE + 1,
                    color: i === 0 ? "1E293B" : "475569",
                    bold: i === 0,
                  }),
                }),
              ],
            }),
        ),
      }),
  );

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "F1F5F9" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "F1F5F9" },
    },
    rows: [headerRow, ...bodyRows],
  });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const record = await prisma.recording.findUnique({ where: { id: params.id } });
  if (!record) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  const url = new URL(request.url);
  const withTranscript = url.searchParams.get("transcript") !== "0";

  const tags = parseStringArray(record.tags);
  const createdAtLabel = formatDateTime(record.createdAt);
  const durationLabel = formatDuration(record.duration);

  const children: Array<Paragraph | Table> = [];

  // 标题
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: record.title || "未命名录音",
          bold: true,
          size: TITLE_SIZE,
          color: "0F172A",
          font: FONT,
        }),
      ],
    }),
  );

  // 元信息
  const meta = [createdAtLabel, `时长 ${durationLabel}`];
  if (tags.length) meta.push(tags.join(" · "));
  if (record.mock) meta.push("⚠ 演示数据，与录音无关");

  children.push(
    new Paragraph({
      spacing: { after: 260 },
      children: [
        new TextRun({
          text: meta.join("    |    "),
          size: SMALL_SIZE,
          color: "94A3B8",
          font: FONT,
        }),
      ],
    }),
  );

  // 正文：纪要 Markdown
  const summary = record.summary?.trim() ?? "";
  if (summary) {
    for (const block of parseMarkdownBlocks(summary)) {
      if (block.type === "heading") {
        children.push(heading(block.text));
      } else if (block.type === "para") {
        children.push(bodyPara(block.text));
      } else if (block.type === "list") {
        block.items.forEach((item, i) => children.push(bullet(item, false, i)));
      } else if (block.type === "ordered") {
        block.items.forEach((item, i) => children.push(bullet(item, true, i)));
      } else if (block.type === "quote") {
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 120, line: 320 },
            indent: { left: 360 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: "BFDBFE", space: 8 },
            },
            children: inlineRuns(block.text, { color: "475569" }),
          }),
        );
      } else {
        children.push(buildTable(block.head, block.rows));
        // 表格后留白，否则下一段贴着表格
        children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
      }
    }
  } else {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "（这条记录还没有生成纪要）",
            size: BODY_SIZE,
            color: "94A3B8",
            font: FONT,
          }),
        ],
      }),
    );
  }

  // 附录：逐字稿，另起一页
  const transcript = record.transcript?.trim() ?? "";
  if (withTranscript && transcript) {
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: "附：完整逐字稿",
            bold: true,
            size: HEADING_SIZE,
            color: "0F172A",
            font: FONT,
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: "以下为语音识别原文，未做修改，可能存在识别错误。",
            size: SMALL_SIZE,
            color: "94A3B8",
            font: FONT,
          }),
        ],
      }),
    );

    // 按原换行分段；没有换行的长文按句号断句，否则 Word 里一坨没法看
    // （不用 lookbehind，tsconfig 目标是 es5）
    const paragraphs = transcript.includes("\n")
      ? transcript.split(/\n+/)
      : transcript.replace(/([。！？!?])/g, "$1\n").split("\n");

    for (const p of paragraphs) {
      const line = p.trim();
      if (!line) continue;
      children.push(
        new Paragraph({
          spacing: { after: 60, line: 300 },
          children: [
            new TextRun({ text: line, size: SMALL_SIZE + 1, color: "64748B", font: FONT }),
          ],
        }),
      );
    }
  }

  // 页脚：来源
  children.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "由 EchoNote 生成",
          size: 16,
          color: "CBD5E1",
          font: FONT,
        }),
      ],
    }),
  );

  const section: ISectionOptions = {
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  };

  const doc = new Document({
    creator: "EchoNote",
    title: record.title || "未命名录音",
    description: "会议纪要",
    sections: [section],
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `${safeFileName(record.title || "未命名录音")}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // filename 给老浏览器兜底，filename* 才是真正的中文名
      "Content-Disposition": `attachment; filename="note.docx"; filename*=UTF-8''${encodeURIComponent(
        fileName,
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
