"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PencilIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

export function EditableTitle({ id, initial }: { id: string; initial: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = async () => {
    const next = value.trim();
    if (!next || next === initial) {
      setValue(initial);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error("保存失败");
      setEditing(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 900);
      toast("标题已更新");
      router.refresh();
    } catch {
      toast("保存失败，请重试", "error");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setValue(initial);
              setEditing(false);
            }
          }}
          className="w-full max-w-md rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xl font-bold text-slate-900 outline-none ring-2 ring-brand-100 sm:text-2xl"
          autoFocus
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="pressable min-h-[44px] rounded-lg bg-brand-600 px-3 text-sm font-medium text-white"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
        {value}
      </h1>
      <button
        type="button"
        aria-label="编辑标题"
        onClick={() => setEditing(true)}
        className={cn(
          "pressable relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-600",
          justSaved && "text-emerald-500",
        )}
      >
        {justSaved ? (
          <svg viewBox="0 0 24 24" className="check-draw h-5 w-5" data-checked="true">
            <path
              d="M5 12.5 10 17.5 19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <PencilIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
