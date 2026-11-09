export type MarkdownInput = {
  title: string;
  createdAtLabel: string;
  durationLabel: string;
  summary: string;
  todos: string[];
  todosDone: number[];
  keyPoints: string[];
  transcript: string;
  /** 用户标签，导出时附在元信息里 */
  tags?: string[];
};

/** 单条记录的 Markdown 排版，详情页导出与全量导出共用 */
export function buildRecordingMarkdown(p: MarkdownInput): string {
  const done = new Set(p.todosDone);
  const todos = p.todos.length
    ? p.todos.map((t, i) => `- [${done.has(i) ? "x" : " "}] ${t}`).join("\n")
    : "-（无）";
  const keyPoints = p.keyPoints.length
    ? p.keyPoints.map((k) => `\`${k}\``).join(" · ")
    : "（无）";
  const tags = p.tags?.length ? p.tags.join(" · ") : "";

  return [
    `# ${p.title}`,
    "",
    `- 时间：${p.createdAtLabel}`,
    `- 时长：${p.durationLabel}`,
    ...(tags ? [`- 标签：${tags}`] : []),
    "",
    "## 摘要",
    "",
    p.summary || "（无）",
    "",
    "## 待办",
    "",
    todos,
    "",
    "## 关键词",
    "",
    keyPoints,
    "",
    "## 逐字稿",
    "",
    p.transcript || "（无）",
    "",
  ].join("\n");
}

/** 文件名去掉非法字符，避免 Windows / macOS 保存失败 */
export function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || "EchoNote";
}

/** 多条记录合并成一份文档，前面带目录 */
export function buildAllMarkdown(items: MarkdownInput[]): string {
  if (items.length === 0) {
    return [
      "# EchoNote 笔记导出",
      "",
      "共 0 条记录。",
      "",
      "## 目录",
      "",
      "（还没有任何录音）",
      "",
    ].join("\n");
  }

  const toc = items
    .map((p, i) => `${i + 1}. ${p.title} —— ${p.createdAtLabel}`)
    .join("\n");

  const body = items.map((p) => buildRecordingMarkdown(p)).join("\n---\n\n");

  return [
    "# EchoNote 笔记导出",
    "",
    `共 ${items.length} 条记录。`,
    "",
    "## 目录",
    "",
    toc,
    "",
    "---",
    "",
    body,
  ].join("\n");
}
