"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { AlertIcon, CloseIcon } from "./Icons";

type Props = {
  id: string;
  open: boolean;
  onClose: () => void;
};

type State =
  | { phase: "loading" }
  | { phase: "ready"; token: string | null }
  | { phase: "error"; message: string };

/**
 * 只读分享：生成一条不可猜的链接，拿到链接的人只能看，不能改也不能删。
 * 关掉后旧链接立即失效。
 */
export function ShareDialog({ id, open, onClose }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setOrigin(window.location.origin);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ phase: "loading" });

    fetch(`/api/recordings/${id}/share`)
      .then(async (res) => {
        if (!res.ok) throw new Error("读取失败");
        return (await res.json()) as { token: string | null };
      })
      .then((data) => {
        if (alive) setState({ phase: "ready", token: data.token });
      })
      .catch(() => {
        if (alive) setState({ phase: "error", message: "读取分享状态失败" });
      });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, id, onClose]);

  if (!open || !mounted) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/recordings/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("操作失败");
      const data = (await res.json()) as { token: string | null };
      setState({ phase: "ready", token: data.token });
      toast(enabled ? "分享链接已开启" : "分享已关闭，旧链接失效");
      router.refresh();
    } catch {
      toast("操作失败，请稍后再试", "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (state.phase !== "ready" || !state.token) return;
    const url = `${origin}/s/${state.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制");
    } catch {
      // 非 HTTPS 或没给权限时降级：选中文本让用户自己复制
      inputRef.current?.select();
      toast("请手动复制选中的链接", "info");
    }
  };

  const link = state.phase === "ready" && state.token ? `${origin}/s/${state.token}` : "";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="animate-fade-in absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]"
        onClick={() => !busy && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="只读分享"
        className="dialog-enter relative w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">只读分享</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              拿到链接的人只能查看逐字稿和纪要，不能修改、删除或导出。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="pressable -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {state.phase === "loading" ? (
          <p className="mt-5 text-sm text-slate-400">读取中…</p>
        ) : state.phase === "error" ? (
          <p className="mt-5 flex items-start gap-1.5 text-sm text-red-600">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {state.message}
          </p>
        ) : state.token ? (
          <div className="mt-4 space-y-3">
            <input
              ref={inputRef}
              readOnly
              value={link}
              aria-label="分享链接"
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-brand-400"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void copy()} disabled={busy}>
                复制链接
              </Button>
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                预览
              </a>
              <Button variant="ghost" onClick={() => void toggle(false)} disabled={busy}>
                关闭分享
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              关闭后这条链接立刻失效；重新开启会生成新的链接。
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-slate-500">当前未分享。</p>
            <Button className="mt-3" onClick={() => void toggle(true)} disabled={busy}>
              {busy ? "生成中…" : "生成分享链接"}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
