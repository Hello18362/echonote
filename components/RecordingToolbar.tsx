"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSelection } from "./SelectionProvider";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";
import { SearchIcon, CloseIcon, SelectIcon, TrashIcon, CheckIcon } from "./Icons";
import { STATUS_FILTERS, SORT_OPTIONS, type ListQuery } from "@/lib/query";
import { cn } from "@/lib/cn";

export function RecordingToolbar({ total, query }: { total: number; query: ListQuery }) {
  const router = useRouter();
  const { toast } = useToast();
  const { active, setActive, selected, clear, selectAllRendered, renderedIds } = useSelection();

  const [keyword, setKeyword] = useState(query.q ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 外部（浏览器前进后退）改了 q 时同步回输入框
  useEffect(() => {
    setKeyword(query.q ?? "");
  }, [query.q]);

  const navigate = (patch: Partial<ListQuery>) => {
    const merged: ListQuery = {
      q: query.q,
      status: query.status,
      sort: query.sort,
      tag: query.tag,
      ...patch,
    };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.status && merged.status !== "all") params.set("status", merged.status);
    if (merged.sort && merged.sort !== "new") params.set("sort", merged.sort);
    if (merged.tag) params.set("tag", merged.tag);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  };

  // 输入防抖，避免每敲一个字就打一次数据库
  useEffect(() => {
    const current = (query.q ?? "").trim();
    if (keyword.trim() === current) return;
    const timer = setTimeout(() => {
      navigate({ q: keyword.trim() });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const allIds = active ? renderedIds() : [];
  const allSelected = allIds.length > 0 && selected.length >= allIds.length;

  const handleBulkDelete = async () => {
    if (selected.length === 0) throw new Error("没有选中项");
    setDeleting(true);
    try {
      const res = await fetch("/api/recordings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "删除失败");
      }
      const data = (await res.json()) as { deleted: number };
      toast(`已删除 ${data.deleted} 条`);
      clear();
      setActive(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-52">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题或内容"
            aria-label="搜索录音"
            className="h-11 w-full rounded-full border border-transparent bg-white pl-10 pr-9 text-[14px] text-slate-900 outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
          />
          {keyword ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <select
          value={query.sort ?? "new"}
          onChange={(e) => navigate({ sort: e.target.value })}
          aria-label="排序方式"
          className="h-11 shrink-0 rounded-full border border-transparent bg-white px-4 text-[14px] text-slate-600 outline-none transition-colors duration-200 focus:border-brand-500"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {query.tag ? (
            <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-brand-50 pl-3 pr-2 text-[13px] font-medium text-brand-700">
              标签：{query.tag}
              <button
                type="button"
                onClick={() => navigate({ tag: "" })}
                aria-label="清除标签筛选"
                className="pressable flex h-5 w-5 items-center justify-center rounded text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-700"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          ) : null}

          {STATUS_FILTERS.map((f) => {
            const on = (query.status ?? "all") === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => navigate({ status: f.value })}
                className={cn(
                  "h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-200",
                  on
                    ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                    : "text-slate-500 hover:text-slate-900",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {active ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (allSelected ? clear() : selectAllRendered())}
              className="pressable h-9 btn-pill bg-white px-3.5 text-[13px] font-medium text-slate-600 shadow-card transition-shadow"
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
            <button
              type="button"
              disabled={selected.length === 0 || deleting}
              onClick={() => setConfirmOpen(true)}
              className="pressable inline-flex h-9 btn-pill items-center gap-1 bg-red-500 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              删除{selected.length ? ` ${selected.length}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setActive(false)}
              className="pressable inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <CloseIcon className="h-3.5 w-3.5" />
              退出
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setActive(true)}
            className="h-9 rounded-full bg-white px-3.5 text-[13px] font-medium text-slate-600 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-colors duration-200 hover:text-slate-900"
          >
            <SelectIcon className="h-3.5 w-3.5" />
            {total > 0 ? "批量选择" : "选择"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>
          {query.q || query.tag || (query.status && query.status !== "all")
            ? `筛选出 ${total} 条`
            : `共 ${total} 条录音`}
        </span>
        {active && selected.length > 0 ? (
          <>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className="inline-flex items-center gap-1 text-brand-600">
              <CheckIcon className="h-3 w-3" />
              已选 {selected.length} 条
            </span>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`删除选中的 ${selected.length} 条录音？`}
        description="删除后无法恢复，相关的逐字稿、纪要和音频文件都会一起消失。"
        confirmText="确认删除"
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
