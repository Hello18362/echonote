"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderIcon, RefreshIcon, CheckIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

type ScanResponse = {
  imported?: Array<{ id: string; title: string }>;
  pending?: number;
  error?: string;
};

/**
 * 首页的「录音收件箱」提示条。
 *
 * 手机录完音之后最短的路径不是打开浏览器，而是把文件丢进电脑上一个文件夹。
 * 这个组件负责三件事：告诉人文件夹在哪、能一键打开、以及进来时顺手扫一遍。
 */
export function InboxHint({ dir }: { dir: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  const scan = useCallback(
    async (manual: boolean) => {
      if (manual) setBusy(true);
      try {
        const res = await fetch("/api/inbox", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "scan" }),
        });
        const data = (await res.json().catch(() => ({}))) as ScanResponse;
        if (!res.ok) {
          if (manual) toast(data.error || "扫描失败", "error");
          return;
        }
        const n = data.imported?.length ?? 0;
        if (n > 0) {
          toast(n === 1 ? `已导入「${data.imported?.[0]?.title ?? "录音"}」` : `已导入 ${n} 个录音`);
          router.refresh();
        } else if (manual) {
          toast("收件箱里没有新的录音文件");
        }
      } catch {
        if (manual) toast("扫描失败，检查服务是否还在跑", "error");
      } finally {
        if (alive.current && manual) setBusy(false);
      }
    },
    [router, toast],
  );

  // 进页面先扫一次（可能刚丢完文件），之后每 25 秒看一次；
  // 页面切到后台就停，别让一个看不见的标签页一直发请求
  useEffect(() => {
    alive.current = true;
    void scan(false);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void scan(false);
    }, 25000);

    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [scan]);

  const openFolder = async () => {
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open" }),
      });
      if (!res.ok) throw new Error("打开失败");
    } catch {
      toast("打不开文件夹，手动去项目目录里找「录音收件箱」", "error");
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制不了，手动选中路径复制一下", "error");
    }
  };

  return (
    <section className="stagger-item mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <FolderIcon className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">录音收件箱</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              手机录完音，把文件放进下面这个文件夹，网站会自动导入并开始转写。
            </p>
            <button
              type="button"
              onClick={copyPath}
              title="点击复制完整路径"
              className={cn(
                "mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-left font-mono text-[11px] leading-5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700",
              )}
            >
              <span className="truncate">{dir}</span>
              {copied ? (
                <CheckIcon className="h-3 w-3 shrink-0 text-emerald-500" />
              ) : null}
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:pl-4">
          <button
            type="button"
            onClick={() => void openFolder()}
            className="pressable inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <FolderIcon className="h-4 w-4" />
            打开文件夹
          </button>
          <button
            type="button"
            onClick={() => void scan(true)}
            disabled={busy}
            className="pressable inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
          >
            <RefreshIcon className={cn("h-4 w-4", busy && "animate-spin")} />
            {busy ? "扫描中…" : "立即扫描"}
          </button>
        </div>
      </div>
    </section>
  );
}
