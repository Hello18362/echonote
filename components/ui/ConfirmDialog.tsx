"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  onDone?: () => void;
};

/**
 * 01-09 确认弹窗：弹出轻微回弹；确认后原地切换为完成状态（对勾描出）再关闭。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认删除",
  cancelText = "取消",
  danger = true,
  onConfirm,
  onClose,
  onDone,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) setPhase("idle");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "idle") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 弹窗打开时锁住背景滚动
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, phase, onClose]);

  if (!open || !mounted) return null;

  const handleConfirm = async () => {
    if (phase !== "idle") return;
    setPhase("pending");
    try {
      await onConfirm();
      setPhase("done");
      // 让用户看清"完成"状态再收起
      setTimeout(() => {
        onDone?.();
        onClose();
      }, 780);
    } catch {
      setPhase("idle");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="animate-fade-in absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]"
        onClick={() => phase === "idle" && onClose()}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className="dialog-enter relative w-full max-w-[360px] overflow-hidden rounded-[20px] bg-white p-5 shadow-pop"
      >
        {phase === "done" ? (
          <div className="flex flex-col items-center py-3 text-center">
            <svg viewBox="0 0 44 44" className="check-draw h-14 w-14" data-checked="true">
              <circle
                className="check-circle"
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
              />
              <path
                d="M13 22.5 19.5 29 31 16"
                fill="none"
                stroke="#10b981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="mt-3 text-sm font-medium text-slate-800">已删除</p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onClose} disabled={phase === "pending"}>
                {cancelText}
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                onClick={handleConfirm}
                disabled={phase === "pending"}
                className={cn(phase === "pending" && "opacity-80")}
              >
                {phase === "pending" ? (
                  <>
                    <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-white/40 border-t-white" />
                    处理中
                  </>
                ) : (
                  confirmText
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
