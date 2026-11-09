"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloseIcon, PlusIcon } from "./Icons";
import { useToast } from "./ui/Toast";
import { MAX_TAGS, MAX_TAG_LENGTH, normalizeTags } from "@/lib/types";

/**
 * 标签编辑：输入回车即添加，点 × 删除。
 * 每次变更整组提交（PATCH tags），服务端会去重并限量。
 */
export function TagEditor({ id, initial }: { id: string; initial: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // 输入框 blur 会自动添加，紧接着的点击删除会用旧 state 算出一份过期数组，
  // 用 ref 始终拿最新值，避免两个请求互相覆盖
  const tagsRef = useRef<string[]>(initial);

  useEffect(() => {
    tagsRef.current = initial;
    setTags(initial);
  }, [initial]);

  const commit = (next: string[]) => {
    tagsRef.current = next;
    setTags(next);
  };

  const persist = async (next: string[], prev: string[]) => {
    commit(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (!res.ok) throw new Error("保存失败");
      const data = (await res.json()) as { tags?: string[] };
      // 用服务端规范化后的结果，避免本地和库里不一致
      if (Array.isArray(data.tags)) commit(data.tags);
      router.refresh();
    } catch {
      commit(prev);
      toast("标签没保存上，请再试一次", "error");
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    const current = tagsRef.current;
    if (current.length >= MAX_TAGS) {
      toast(`最多 ${MAX_TAGS} 个标签`, "error");
      return;
    }
    const next = normalizeTags([...current, raw]);
    if (next.length === current.length) {
      setDraft("");
      toast("这个标签已经加过了", "info");
      return;
    }
    setDraft("");
    void persist(next, current);
  };

  const remove = (tag: string) => {
    const current = tagsRef.current;
    if (!current.includes(tag)) return;
    void persist(
      current.filter((t) => t !== tag),
      current,
    );
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            data-tag={tag}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium text-slate-600"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              aria-label={`删除标签 ${tag}`}
              className="pressable flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}

        <div className="relative">
          <PlusIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
              if (e.key === "Backspace" && !draft && tags.length > 0) {
                remove(tags[tags.length - 1]);
              }
            }}
            onBlur={add}
            maxLength={MAX_TAG_LENGTH}
            disabled={saving}
            placeholder={tags.length ? "加标签" : "加个标签，比如「周会」"}
            aria-label="添加标签"
            className="h-7 w-32 rounded-lg border border-dashed border-slate-300 bg-white pl-6 pr-2 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-400 focus:border-solid disabled:opacity-60"
          />
        </div>

        {saving ? <span className="text-[11px] text-slate-300">保存中…</span> : null}
      </div>

      {tags.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          给笔记打标签后，可以在首页按标签筛选同类录音。
        </p>
      ) : null}
    </div>
  );
}
