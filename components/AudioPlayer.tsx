"use client";

import { useEffect, useRef, useState } from "react";
import { AlertIcon, WaveIcon } from "./Icons";
import { cn } from "@/lib/cn";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/**
 * 原音频回放：校对逐字稿时边听边改。
 * 用原生 <audio controls>（移动端键盘/耳机控件都能接管），额外加倍速。
 * 服务端只在这条记录确实存了音频时才渲染本组件。
 */
export function AudioPlayer({ id, durationLabel }: { id: string; durationLabel: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <WaveIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">原始录音</p>
            <p className="text-xs text-slate-400">
              {failed ? "音频读取失败" : ready ? `时长 ${durationLabel}` : "加载中…"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              aria-label={`${s} 倍速`}
              className={cn(
                "pressable h-8 rounded-md px-2 text-xs font-medium tabular-nums transition-colors",
                speed === s
                  ? "bg-slate-900 text-white"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={`/api/recordings/${id}/audio`}
        controls
        preload="metadata"
        onLoadedMetadata={() => setReady(true)}
        onError={() => setFailed(true)}
        className="mt-3 h-11 w-full"
      >
        你的浏览器不支持音频播放。
      </audio>

      {failed ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          这条记录的音频文件可能已被手动删除，逐字稿和纪要仍然保留。
        </p>
      ) : null}
    </div>
  );
}
