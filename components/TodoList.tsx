"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";

type Props = {
  /** 记录 id，用于把勾选状态写回数据库 */
  id: string;
  todos: string[];
  /** 已经勾选的下标 */
  initialDone: number[];
};

const R = 14;
const C = 2 * Math.PI * R;

/**
 * 待办清单：
 * - 04-05 笔画勾选（圆圈先画完，对勾再描进去）
 * - 05-11 勾选联动（进度环 + 数字 + 顶部背景三处同时响应）
 * - 勾选结果写回数据库，刷新/换设备都还在
 */
export function TodoList({ id, todos, initialDone }: Props) {
  const { toast } = useToast();
  const [checked, setChecked] = useState<Set<number>>(
    // 只认落在当前待办范围内的下标，否则进度环会算出「5 / 3」
    () => new Set(initialDone.filter((i) => i >= 0 && i < todos.length)),
  );
  const [saving, setSaving] = useState(false);
  const seqRef = useRef(0);

  const total = todos.length;
  const doneCount = checked.size;
  const progress = total === 0 ? 0 : doneCount / total;
  const allDone = total > 0 && doneCount === total;

  const persist = async (next: Set<number>, prev: Set<number>, seq: number) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}/todos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: Array.from(next).sort((a, b) => a - b) }),
      });
      if (!res.ok) throw new Error("保存失败");
    } catch {
      // 只有最后一次操作失败才回滚，避免连续点击时把状态弹回去
      if (seq === seqRef.current) {
        setChecked(prev);
        toast("勾选状态没保存上，请再试一次", "error");
      }
    } finally {
      if (seq === seqRef.current) setSaving(false);
    }
  };

  const toggle = (index: number) => {
    const prev = checked;
    const next = new Set(prev);
    if (next.has(index)) next.delete(index);
    else next.add(index);

    const seq = ++seqRef.current;
    setChecked(next);
    void persist(next, prev, seq);
  };

  const ringOffset = useMemo(() => C * (1 - progress), [progress]);

  if (total === 0) {
    return <p className="text-sm text-slate-400">这条录音没有识别出明确的待办事项</p>;
  }

  return (
    <div>
      <div
        className={cn(
          "mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300",
          allDone ? "bg-emerald-50" : "bg-slate-50",
        )}
      >
        <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
          <circle cx="18" cy="18" r={R} fill="none" stroke="#e2e8f0" strokeWidth="4" />
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            stroke={allDone ? "#10b981" : "#2563eb"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={ringOffset}
            style={{ transition: "stroke-dashoffset 420ms cubic-bezier(0.32,0.72,0,1), stroke 300ms ease" }}
          />
        </svg>
        <div className="flex-1">
          <p
            className={cn(
              "text-sm font-medium transition-colors duration-300",
              allDone ? "text-emerald-700" : "text-slate-700",
            )}
          >
            {allDone ? "全部完成" : "待办进度"}
          </p>
          <p className="text-xs text-slate-400">
            {doneCount} / {total} 项
            {saving ? <span className="ml-1.5 text-slate-300">· 保存中</span> : null}
          </p>
        </div>
      </div>

      <ul className="space-y-1">
        {todos.map((todo, i) => {
          const isDone = checked.has(i);
          return (
            <li key={`${i}-${todo}`}>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-pressed={isDone}
                className="pressable flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-slate-50"
              >
                <svg
                  viewBox="0 0 44 44"
                  className="check-draw mt-0.5 h-5 w-5 shrink-0"
                  data-checked={isDone}
                >
                  <circle
                    className="check-circle"
                    cx="22"
                    cy="22"
                    r="19"
                    fill="none"
                    stroke={isDone ? "#10b981" : "#cbd5e1"}
                    strokeWidth="3"
                    style={{
                      strokeDasharray: 120,
                      strokeDashoffset: 0,
                      transition: "stroke 200ms ease",
                    }}
                  />
                  <path
                    d="M14 22.5 20 28.5 31 16"
                    fill="none"
                    stroke={isDone ? "#10b981" : "transparent"}
                    strokeWidth="3.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: "stroke 200ms ease 80ms, stroke-dashoffset 320ms cubic-bezier(0.65,0,0.35,1) 120ms" }}
                  />
                </svg>
                <span
                  className={cn(
                    "flex-1 text-sm leading-relaxed transition-all duration-200",
                    isDone ? "text-slate-400 line-through" : "text-slate-700",
                  )}
                >
                  {todo}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
