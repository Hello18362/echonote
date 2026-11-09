"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { UploadIcon } from "@/components/Icons";
import { cn } from "@/lib/cn";

/** 从音频文件读时长；读不到返回 0（服务端会拒绝 0 秒） */
async function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      const done = (v: number) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const d = Number(audio.duration);
        done(Number.isFinite(d) && d > 0 ? Math.round(d) : 0);
      };
      audio.onerror = () => done(0);
      audio.src = url;
      // 手机上传的大文件偶尔读不出 metadata，别让它一直挂着
      setTimeout(() => done(0), 5000);
    } catch {
      resolve(0);
    }
  });
}

/**
 * 首页的上传入口。
 * 手机录完音之后的主路径是「选文件 → 上传 → 自动开始处理」，
 * 不该逼用户先进录音页再往下找。
 */
export function QuickUpload({ className }: { className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;

    setBusy(true);
    try {
      let duration = await readDuration(file);
      // 读不到时长时给个 1 秒兜底，否则会被后端按「时长为 0」拒绝
      if (!duration) duration = 1;

      const form = new FormData();
      form.append("audio", file);
      form.append("duration", String(duration));

      const res = await fetch("/api/recordings", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        throw new Error(data.error || "上传失败");
      }

      // 立刻触发处理，用户不用再点一次
      await fetch(`/api/recordings/${data.id}/process`, { method: "POST" }).catch(() => null);
      toast("已上传，开始转写");
      router.push(`/processing/${data.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "上传失败，请重试", "error");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="上传音频文件"
        title="上传音频文件（手机录音可从这里导入）"
        className={cn(
          "pressable inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60",
          className,
        )}
      >
        <UploadIcon className={cn("h-4 w-4", busy && "animate-pulse")} />
        <span className="hidden sm:inline">{busy ? "上传中…" : "上传音频"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleFile(e)}
      />
    </>
  );
}
