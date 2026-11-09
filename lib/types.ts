export type RecordingStatus =
  | "pending"
  | "transcribing"
  | "summarizing"
  | "done"
  | "error";

export type RecordingListItem = {
  id: string;
  title: string;
  duration: number;
  status: RecordingStatus;
  summary: string;
  error: string | null;
  /** true 表示内容是内置示例，不是真实转写 */
  mock: boolean;
  /** 用户自建标签 */
  tags: string[];
  createdAt: string; // ISO 字符串
};

export type RecordingDetail = RecordingListItem & {
  transcript: string;
  todos: string[];
  /** 已勾选的待办下标 */
  todosDone: number[];
  keyPoints: string[];
  /** 正文被手动改过 */
  edited: boolean;
  /** 是否已开启只读分享 */
  shared: boolean;
};

export type SummaryResult = {
  summary: string;
  todos: string[];
  keyPoints: string[];
};

export const STATUS_LABEL: Record<RecordingStatus, string> = {
  pending: "排队中",
  transcribing: "转写中",
  summarizing: "总结中",
  done: "已完成",
  error: "失败",
};

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((i) => typeof i === "string") : [];
  } catch {
    return [];
  }
}

/** 解析存库的下标数组，过滤掉负数与非整数 */
export function parseNumberArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0);
  } catch {
    return [];
  }
}

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 20;

/**
 * 标签规范化：去空白、去重（忽略大小写）、限长限量。
 * 存库与校验共用，保证前端显示和查询条件一致。
 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    if (typeof raw !== "string") continue;
    // 标签里不允许逗号/换行，否则前端输入框拆分逻辑会乱
    const tag = raw.replace(/[,，\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
