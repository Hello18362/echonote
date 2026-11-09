"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, CloseIcon } from "./Icons";
import { useToast } from "./ui/Toast";
import { cn } from "@/lib/cn";

type Field = "transcript" | "summary" | "todos" | "keyPoints";

type Props = {
  id: string;
  field: Field;
  label: string;
  /** text 存字符串；lines 按行拆成数组（待办 / 关键词） */
  mode?: "text" | "lines";
  initial: string | string[];
  rows?: number;
  placeholder?: string;
  /** 标题右侧的小字说明 */
  hint?: string;
  /** 展示态内容，由服务端渲染 */
  children: ReactNode;
};

/**
 * 可编辑区块：AI 听错一个词、总结跑偏时，直接改，不用整条重跑。
 * 保存走 PATCH /api/recordings/[id]，成功后刷新服务端数据。
 */
export function EditableSection({
  id,
  field,
  label,
  mode = "text",
  initial,
  rows = 6,
  placeholder,
  hint,
  children,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const toText = (v: string | string[]) => (Array.isArray(v) ? v.join("\n") : v);
  const initialText = toText(initial);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  // 服务端刷新后同步过来，避免下次进入编辑态还是旧内容
  useEffect(() => {
    if (!editing) setText(toText(initial));
  }, [initial, editing]);

  const cancel = () => {
    setText(initialText);
    setEditing(false);
  };

  const save = async () => {
    if (saving) return;

    const payload =
      mode === "lines"
        ? {
            [field]: text
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : { [field]: text };

    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "保存失败");
      }
      setEditing(false);
      toast(`${label}已保存`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "保存失败，请重试", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
        {editing ? null : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`编辑${label}`}
            className="pressable -mr-1 flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <PencilIcon className="h-3.5 w-3.5" />
            编辑
          </button>
        )}
      </div>

      {hint && !editing ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}

      {editing ? (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
              if (e.key === "Escape") cancel();
            }}
            className="thin-scroll w-full resize-y rounded-xl border border-brand-300 bg-white px-3 py-2.5 text-sm leading-7 text-slate-800 outline-none ring-2 ring-brand-100 placeholder:text-slate-400"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {mode === "lines" ? "每行一条，空行会被忽略" : "⌘/Ctrl + Enter 保存，Esc 取消"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="pressable inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <CloseIcon className="h-3.5 w-3.5" />
                取消
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className={cn(
                  "pressable inline-flex h-9 items-center gap-1 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60",
                )}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
