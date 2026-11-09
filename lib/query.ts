import type { Prisma } from "@prisma/client";

/** 首页列表的可选筛选条件，全部通过 URL 查询参数传递 */
export type ListQuery = {
  /** 关键词，匹配标题 / 摘要 / 逐字稿 / 标签 */
  q?: string;
  /** all | processing | done | error */
  status?: string;
  /** new（默认）| old | long | short */
  sort?: string;
  /** 按标签筛选，精确匹配单个标签 */
  tag?: string;
};

export const STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "processing", label: "处理中" },
  { value: "done", label: "已完成" },
  { value: "error", label: "失败" },
] as const;

export const SORT_OPTIONS = [
  { value: "new", label: "最新优先" },
  { value: "old", label: "最早优先" },
  { value: "long", label: "时长最长" },
  { value: "short", label: "时长最短" },
] as const;

const PROCESSING_STATUSES = ["pending", "transcribing", "summarizing"];

export function normalizeQuery(raw: ListQuery): ListQuery {
  const q = (raw.q ?? "").trim().slice(0, 80);
  const status = STATUS_FILTERS.some((s) => s.value === raw.status) ? raw.status : "all";
  const sort = SORT_OPTIONS.some((s) => s.value === raw.sort) ? raw.sort : "new";
  const tag = (raw.tag ?? "").trim().slice(0, 20);
  return { q, status, sort, tag };
}

/** 关键词 + 状态 + 标签 → Prisma where */
export function buildWhere(query: ListQuery): Prisma.RecordingWhereInput {
  const where: Prisma.RecordingWhereInput = {};

  if (query.q) {
    where.OR = [
      { title: { contains: query.q } },
      { summary: { contains: query.q } },
      { transcript: { contains: query.q } },
      { tags: { contains: query.q } },
    ];
  }

  if (query.status === "processing") {
    where.status = { in: PROCESSING_STATUSES };
  } else if (query.status === "done" || query.status === "error") {
    where.status = query.status;
  }

  if (query.tag) {
    // 标签存成 JSON 数组字符串，带引号匹配可避免 "ab" 命中 "a" 这类前缀误伤
    where.AND = [{ tags: { contains: `"${query.tag}"` } }];
  }

  return where;
}

export function buildOrderBy(query: ListQuery): Prisma.RecordingOrderByWithRelationInput {
  switch (query.sort) {
    case "old":
      return { createdAt: "asc" };
    case "long":
      return { duration: "desc" };
    case "short":
      return { duration: "asc" };
    default:
      return { createdAt: "desc" };
  }
}

/** 从 URLSearchParams 读查询条件 */
export function queryFromSearchParams(sp: URLSearchParams): ListQuery {
  return normalizeQuery({
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    tag: sp.get("tag") ?? undefined,
  });
}
