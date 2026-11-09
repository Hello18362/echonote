/**
 * 会议纪要的结构与排版。
 *
 * 这里是「唯一事实源」：模型只负责产出结构化字段，
 * 排成 Markdown 由 renderMeetingNote 做，页面渲染、Markdown 导出、Word 导出
 * 都消费同一份 Markdown，避免三处各写一套排版、改一处忘两处。
 */

export type MeetingAction = {
  /** 负责人；逐字稿里没说就写「未明确」，绝不猜 */
  who: string;
  what: string;
  /** 截止时间；逐字稿里没说就写「未明确」 */
  when: string;
};

export type MeetingSection = {
  heading: string;
  points: string[];
  /** 本议题的结论/共识，没有就空字符串 */
  conclusion: string;
};

export type MeetingNote = {
  /** 会议主题，比录音默认标题更准确 */
  title: string;
  /** 3-6 句概要：什么会、谁参加、聊了什么、达成什么 */
  overview: string;
  sections: MeetingSection[];
  decisions: string[];
  actions: MeetingAction[];
  /** 悬而未决、需要下次确认的问题 */
  open: string[];
  keywords: string[];
};

const TBD = "未明确";

/** 模型输出不可信，逐字段兜底，任何字段缺失都不能让整条链路崩 */
export function normalizeNote(raw: unknown): MeetingNote {
  const r = (raw ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter((x): x is string => Boolean(x))
      : [];

  const sections: MeetingSection[] = Array.isArray(r.sections)
    ? r.sections
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return {
            heading: str(o.heading) || "未命名议题",
            points: strList(o.points),
            conclusion: str(o.conclusion),
          };
        })
        .filter((s) => s.points.length > 0 || s.conclusion)
    : [];

  const actions: MeetingAction[] = Array.isArray(r.actions)
    ? r.actions
        .map((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return {
            who: str(o.who) || TBD,
            what: str(o.what),
            when: str(o.when) || TBD,
          };
        })
        .filter((a) => a.what)
    : [];

  return {
    title: str(r.title),
    overview: str(r.overview),
    sections,
    decisions: strList(r.decisions),
    actions,
    open: strList(r.open),
    keywords: strList(r.keywords),
  };
}

/** 表格单元格里的 | 会把 Markdown 表格撑坏 */
function cell(text: string): string {
  return text.replace(/\|/g, "｜").replace(/\r?\n/g, " ").trim();
}

/**
 * 结构化纪要 → Markdown。
 * 没有内容的区块整块省略，避免出现一排「（无）」。
 */
export function renderMeetingNote(note: MeetingNote): string {
  const blocks: string[] = [];

  if (note.overview) {
    // 注意用 join("\n") 自成一个块：blocks 最后是 join("\n\n") 拼的，
    // 这里如果 push 标题、空串、正文三个元素，中间会多出两个空行
    blocks.push(["## 会议概要", "", note.overview].join("\n"));
  }

  for (const s of note.sections) {
    const lines: string[] = [`## ${s.heading}`, ""];
    for (const p of s.points) lines.push(`- ${p}`);
    if (s.conclusion) {
      lines.push("", `**结论**：${s.conclusion}`);
    }
    blocks.push(lines.join("\n"));
  }

  if (note.decisions.length) {
    blocks.push(
      ["## 关键决策", "", ...note.decisions.map((d, i) => `${i + 1}. ${d}`)].join("\n"),
    );
  }

  if (note.actions.length) {
    const rows = note.actions.map(
      (a) => `| ${cell(a.what)} | ${cell(a.who)} | ${cell(a.when)} |`,
    );
    blocks.push(
      [
        "## 行动项",
        "",
        "| 事项 | 负责人 | 时间 |",
        "| --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  }

  if (note.open.length) {
    blocks.push(["## 待确认", "", ...note.open.map((o) => `- ${o}`)].join("\n"));
  }

  return blocks.join("\n\n");
}

/** 行动项压成一行，喂给原来的 todos 数组（界面上可勾选） */
export function actionToTodo(a: MeetingAction): string {
  const who = a.who !== TBD ? `${a.who}：` : "";
  const when = a.when !== TBD ? `（${a.when}）` : "";
  return `${who}${a.what}${when}`;
}

/**
 * 从 Markdown 里拆出块，供 Word 导出使用。
 * 只认我们自己的纪要会产生的那几种语法，不做通用 Markdown 解析。
 */
export type MdBlock =
  | { type: "heading"; text: string }
  | { type: "para"; text: string }
  | { type: "list"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

export function parseMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  const flushList = (type: "list" | "ordered", items: string[]) => {
    if (items.length) blocks.push({ type, items });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("#")) {
      blocks.push({ type: "heading", text: trimmed.replace(/^#+\s*/, "") });
      i += 1;
      continue;
    }

    // 表格：连续的 | 开头行
    if (trimmed.startsWith("|")) {
      const raw: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        raw.push(lines[i].trim());
        i += 1;
      }
      const cells = raw
        .filter((l) => !/^\|[\s:|-]+\|$/.test(l))
        .map((l) =>
          l
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim()),
        );
      if (cells.length) {
        blocks.push({ type: "table", head: cells[0], rows: cells.slice(1) });
      }
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim());
        i += 1;
      }
      flushList("list", items);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").trim());
        i += 1;
      }
      flushList("ordered", items);
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push({ type: "quote", text: trimmed.replace(/^>\s*/, "") });
      i += 1;
      continue;
    }

    blocks.push({ type: "para", text: trimmed });
    i += 1;
  }

  return blocks;
}

/** 去掉 **粗体** 标记，Word 里另做样式 */
export function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}
