"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AlertIcon, RefreshIcon } from "@/components/Icons";
import type { RecordingDetail, RecordingStatus } from "@/lib/types";

const STEPS = [
  { key: "transcribing", label: "转写中", desc: "正在把语音转成文字" },
  { key: "summarizing", label: "写纪要中", desc: "正在逐段读完全文并整理成纪要" },
] as const;

const POLL_MS = 1500;

function stageOf(status: RecordingStatus): number {
  if (status === "pending" || status === "transcribing") return 0;
  if (status === "summarizing") return 1;
  if (status === "done") return 2;
  return -1;
}

export function ProcessingPanel({ id }: { id: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<RecordingStatus>("pending");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [networkIssue, setNetworkIssue] = useState(false);
  const [stalled, setStalled] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);
  const navigatedRef = useRef(false);
  /** 连续处于 pending 的轮询次数，用来判断"处理根本没启动" */
  const pendingStreakRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 轮询一次；返回 false 表示应当停止轮询 */
  const pollOnce = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/recordings/${id}`, { cache: "no-store" });
      if (!aliveRef.current) return false;

      if (res.status === 404) {
        setNotFound(true);
        return false;
      }
      if (!res.ok) {
        setNetworkIssue(true);
        return true; // 服务端抖动，继续轮询
      }

      const data = (await res.json()) as RecordingDetail;
      if (!aliveRef.current) return false;
      setNetworkIssue(false);
      setStatus(data.status);
      setError(data.error);

      // 一直是 pending 说明 process 没被触发（请求失败/服务没响应）
      if (data.status === "pending") {
        pendingStreakRef.current += 1;
        if (pendingStreakRef.current >= 8) {
          setStalled(true);
          return false;
        }
      } else {
        pendingStreakRef.current = 0;
        setStalled(false);
      }

      if (data.status === "done") {
        if (!navigatedRef.current) {
          navigatedRef.current = true;
          router.replace(`/note/${id}`);
        }
        return false;
      }
      // error 状态交给用户手动重试，停止轮询
      return data.status !== "error";
    } catch {
      if (!aliveRef.current) return false;
      setNetworkIssue(true);
      return true;
    }
  }, [id, router]);

  /** 启动 / 重启轮询（重试后必须重新拉起，否则会卡在「转写中」不动） */
  const startPolling = useCallback(() => {
    stopPolling();
    timerRef.current = setInterval(() => {
      void pollOnce().then((keep) => {
        if (!keep) stopPolling();
      });
    }, POLL_MS);
  }, [pollOnce, stopPolling]);

  const trigger = useCallback(async () => {
    try {
      await fetch(`/api/recordings/${id}/process`, { method: "POST" });
    } catch {
      /* 网络异常时由轮询兜底 */
    }
  }, [id]);

  useEffect(() => {
    aliveRef.current = true;

    const boot = async () => {
      try {
        const res = await fetch(`/api/recordings/${id}`, { cache: "no-store" });
        if (!aliveRef.current) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setNetworkIssue(true);
          startPolling();
          return;
        }
        const data = (await res.json()) as RecordingDetail;
        if (!aliveRef.current) return;

        setStatus(data.status);
        setError(data.error);

        if (data.status === "done") {
          navigatedRef.current = true;
          router.replace(`/note/${id}`);
          return;
        }
        if (data.status === "error") return; // 等用户点重试
        // 进入时仍排队中 → 自动触发一次处理
        if (data.status === "pending") {
          await trigger();
          if (!aliveRef.current) return;
        }
        startPolling();
      } catch {
        if (!aliveRef.current) return;
        setNetworkIssue(true);
        startPolling();
      }
    };

    void boot();

    return () => {
      aliveRef.current = false;
      stopPolling();
    };
  }, [id, router, startPolling, stopPolling, trigger]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    setNetworkIssue(false);
    setStalled(false);
    pendingStreakRef.current = 0;
    await trigger();
    setStatus("transcribing");
    setRetrying(false);
    startPolling();
  };

  if (notFound) {
    return (
      <div className="stagger-item rounded-[20px] bg-white p-8 text-center">
        <p className="text-sm text-slate-600">记录不存在</p>
        <Link
          href="/"
          className="pressable mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-4 text-sm text-white"
        >
          返回首页
        </Link>
      </div>
    );
  }

  const stage = stageOf(status);
  const failed = status === "error";
  const blocked = failed || stalled;

  return (
    <div className="stagger-item rounded-[20px] bg-white p-6 shadow-card sm:p-8">
      {blocked ? (
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-800">
            {failed ? "处理失败" : "处理没能启动"}
          </p>
          <p className="mt-1.5 max-w-sm break-words text-xs leading-relaxed text-slate-500">
            {failed
              ? error || "未知错误"
              : "可能是网络中断或服务暂时不可用，点下面的按钮重新触发一次"}
          </p>
          <Button className="mt-5" onClick={() => void handleRetry()} disabled={retrying}>
            <RefreshIcon className="h-4 w-4" />
            {retrying ? "重试中…" : "重试"}
          </Button>
        </div>
      ) : (
        <ol className="space-y-1">
          {STEPS.map((step, i) => {
            const done = stage > i || status === "done";
            const active = stage === i && status !== "done";
            return (
              <li key={step.key} className="flex items-start gap-4 rounded-xl p-3">
                <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                  {done ? (
                    <svg
                      viewBox="0 0 44 44"
                      className="check-draw h-8 w-8"
                      data-checked="true"
                      data-anim="circle"
                    >
                      <circle
                        className="check-circle"
                        cx="22"
                        cy="22"
                        r="18"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3"
                      />
                      <path
                        d="M14 22.5 20 28.5 31 17"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : active ? (
                    <>
                      <span className="h-8 w-8 animate-spin-slow rounded-full border-[2.5px] border-slate-200 border-t-brand-600" />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
                      </span>
                    </>
                  ) : (
                    <span className="h-8 w-8 rounded-full border-2 border-slate-200" />
                  )}
                </span>

                <span className="flex-1">
                  <span
                    className={
                      active
                        ? "text-sm font-semibold text-slate-900"
                        : done
                          ? "text-sm font-medium text-slate-700"
                          : "text-sm font-medium text-slate-400"
                    }
                  >
                    {i + 1}. {step.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">{step.desc}</span>

                  {active ? (
                    <span className="mt-2 block space-y-1.5">
                      <span className="skeleton block h-2.5 w-3/4" />
                      <span className="skeleton block h-2.5 w-1/2" />
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {!blocked ? (
        <p className="mt-2 text-center text-xs text-slate-400">
          {networkIssue ? "网络有点卡，正在自动重试…" : "处理通常需要几秒，页面会自动跳转"}
        </p>
      ) : null}
    </div>
  );
}
