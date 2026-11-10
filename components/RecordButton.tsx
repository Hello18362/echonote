"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, StopIcon, UploadIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import { formatDuration } from "@/lib/format";

type Phase = "idle" | "requesting" | "recording" | "uploading";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported?.(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

async function readFileDuration(file: File): Promise<number> {
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
      setTimeout(() => done(0), 4000);
    } catch {
      resolve(0);
    }
  });
}

export function RecordButton({ mockMode = false }: { mockMode?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"record" | "submit" | "embedded">("record");
  /** 页面是否被嵌在 iframe / 内嵌预览窗口里（这种环境拿不到麦克风权限） */
  const [embedded, setEmbedded] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>("");
  const elapsedRef = useRef(0);
  const aliveRef = useRef(true);
  /** 上次失败的提交，支持原样重试，不用重录 */
  const pendingRef = useRef<{ blob: Blob; duration: number } | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 内嵌环境（预览面板 / iframe）里，浏览器直接拒绝麦克风，且不会弹授权框
  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top);
    } catch {
      // 跨域访问 window.top 会抛错，说明确实被嵌入了
      setEmbedded(true);
    }
  }, []);

  const openInNewTab = useCallback(() => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // 离开页面时先解绑 onstop，避免停止轨道触发一次"幽灵提交"
      if (recorderRef.current) {
        recorderRef.current.onstop = null;
        if (recorderRef.current.state !== "inactive") {
          try {
            recorderRef.current.stop();
          } catch {
            /* ignore */
          }
        }
      }
      stopTimer();
      cleanupStream();
    };
  }, [stopTimer, cleanupStream]);

  const submit = useCallback(
    async (blob: Blob, duration: number) => {
      if (duration <= 0) {
        toast("录音时长为 0，无法提交", "error");
        return;
      }

      setPhase("uploading");
      setError(null);
      setErrorKind("submit");
      pendingRef.current = { blob, duration };

      const ext = mimeRef.current.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `recording.${ext}`, {
        type: blob.type || mimeRef.current || "audio/webm",
      });

      const form = new FormData();
      form.append("audio", file);
      form.append("duration", String(duration));

      try {
        const res = await fetch("/api/recordings", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          error?: string;
        };
        if (!res.ok || !data.id) {
          throw new Error(data.error || "提交失败");
        }
        pendingRef.current = null;
        if (!aliveRef.current) return;
        toast("已上传，开始处理");
        router.push(`/processing/${data.id}`);
      } catch (err) {
        console.error(err);
        if (!aliveRef.current) return;
        setPhase("idle");
        setError(err instanceof Error ? err.message : "提交失败，请重试");
      }
    },
    [router, toast],
  );

  const start = useCallback(async () => {
    setError(null);
    setErrorKind("record");

    if (embedded) {
      setErrorKind("embedded");
      setError(
        "当前页面被嵌在内嵌窗口（预览面板）里，浏览器不会给这种页面麦克风权限，也不会弹授权框。请在独立浏览器标签页打开后再录音。",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext === false
          ? "浏览器不允许在 http:// 地址下录音（当前是局域网 IP 访问）。手机请用「手机访问.bat」生成的 https 地址打开；或先录好音，再用页面下方的「上传音频文件」导入。"
          : "当前浏览器不支持录音，请更换 Chrome / Edge / Safari",
      );
      return;
    }

    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopTimer();
        cleanupStream();
        const seconds = Math.round(elapsedRef.current);
        // 空录音（<1 秒）：不提交，直接复位并提示
        if (seconds < 1) {
          chunksRef.current = [];
          if (aliveRef.current) {
            setPhase("idle");
            setElapsed(0);
            toast("录音太短，请至少录 1 秒", "error");
          }
          return;
        }
        const type = mimeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        void submit(blob, seconds);
      };

      recorder.start();
      setElapsed(0);
      elapsedRef.current = 0;
      setPhase("recording");
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } catch (err) {
      console.error(err);
      setPhase("idle");
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "麦克风权限被拒绝。请点浏览器地址栏左侧的图标 → 「网站设置」→ 把「麦克风」改为「允许」，然后刷新页面重试。"
          : name === "NotFoundError"
            ? "没有检测到麦克风设备"
            : "无法开始录音，请检查浏览器权限设置",
      );
    }
  }, [cleanupStream, embedded, stopTimer, submit, toast]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setPhase("uploading");
    }
  }, []);

  const handleMainClick = () => {
    if (phase === "idle") void start();
    else if (phase === "recording") stop();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    let duration = await readFileDuration(file);
    if (!duration) duration = 1; // 读不到时长时兜底，避免被服务端拒绝
    mimeRef.current = file.type || "audio/webm";
    void submit(file, duration);
  };

  const recording = phase === "recording";
  const busy = phase === "requesting" || phase === "uploading";

  return (
    <div className="flex flex-col items-center">
      {/* 演示模式提示：不提示清楚，用户会以为真的识别了 */}
      {mockMode ? (
        <div className="mb-4 w-full max-w-md rounded-[16px] bg-slate-50 px-4 py-3.5 text-left">
          <p className="text-sm font-medium text-slate-700">演示模式：不会识别你的录音</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            还没配置语音识别 / 大模型服务。提交后会返回一份内置的示例纪要（一段虚构的项目周会），
            <strong className="font-medium text-slate-600">与你说的话没有任何关系</strong>
            。到
            <Link href="/settings" className="mx-1 font-medium text-brand-600 underline underline-offset-2">
              设置页
            </Link>
            填好服务与 Key 后即可真正转写，保存后立即生效。
          </p>
        </div>
      ) : null}

      {/* 内嵌环境提示：预览面板里的 iframe 拿不到麦克风，先引导用户开独立标签页 */}
      {embedded ? (
        <div className="mb-8 w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-left">
          <p className="text-sm font-medium text-amber-800">当前在预览面板的内嵌窗口里打开</p>
          <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
            浏览器不允许内嵌页面使用麦克风，也不会弹出授权框。点下面的按钮在独立标签页打开，就能正常录音。
          </p>
          <button
            type="button"
            onClick={openInNewTab}
            className="pressable mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-amber-600 px-3.5 text-xs font-medium text-white"
          >
            在新标签页打开
          </button>
        </div>
      ) : null}

      {/* 大圆形录音按钮：待录是苹果蓝，录制中红色 + 呼吸动画 */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        {recording ? (
          <>
            <span className="pulse-ring absolute h-28 w-28 rounded-full bg-red-500/40" />
            <span
              className="pulse-ring absolute h-28 w-28 rounded-full bg-red-500/30"
              style={{ animationDelay: "600ms" }}
            />
          </>
        ) : null}

        <button
          type="button"
          onClick={handleMainClick}
          disabled={busy}
          aria-label={recording ? "停止录音" : "开始录音"}
          className={[
            "pressable relative z-10 flex h-28 w-28 items-center justify-center rounded-full text-white shadow-lg transition-colors duration-300",
            recording
              ? "bg-red-500 shadow-[0_10px_40px_rgba(239,68,68,0.35)]"
              : "bg-brand-600 shadow-[0_10px_36px_rgba(0,113,227,0.32)] hover:bg-brand-700",
            busy ? "cursor-wait opacity-90" : "",
          ].join(" ")}
        >
          {busy ? (
            <span className="h-8 w-8 animate-spin-slow rounded-full border-[3px] border-white/40 border-t-white" />
          ) : recording ? (
            <StopIcon className="h-10 w-10" />
          ) : (
            <MicIcon className="h-11 w-11" strokeWidth={1.6} />
          )}
        </button>
      </div>

      {/* 计时器：录制中显示 mm:ss */}
      <div className="mt-6 h-10 text-center">
        {recording ? (
          <div className="flex flex-col items-center">
            <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
              {formatDuration(elapsed)}
            </span>
            <span className="mt-1 text-xs text-red-500">正在录音，点击结束</span>
          </div>
        ) : busy ? (
          <p className="text-sm text-slate-500">
            {phase === "requesting" ? "正在获取麦克风权限…" : "正在上传并创建记录…"}
          </p>
        ) : (
          <p className="text-sm text-slate-500">点击开始录音</p>
        )}
      </div>

      {error ? (
        <div className="mt-4 max-w-sm rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              if (errorKind === "embedded") {
                openInNewTab();
                return;
              }
              const pending = pendingRef.current;
              if (errorKind === "submit" && pending) {
                void submit(pending.blob, pending.duration);
              } else {
                void start();
              }
            }}
            className="pressable mt-2 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 underline decoration-red-300 underline-offset-4"
          >
            {errorKind === "embedded"
              ? "在新标签页打开"
              : errorKind === "submit" && pendingRef.current
                ? "重试提交"
                : "重试"}
          </button>
        </div>
      ) : null}

      {/* 上传音频入口 */}
      <label className="pressable mt-8 inline-flex min-h-[44px] cursor-pointer items-center gap-2 btn-pill bg-white px-5 text-[15px] font-medium text-slate-700 shadow-card transition-colors duration-200 hover:shadow-card-hover">
        <UploadIcon className="h-4 w-4" />
        上传音频文件
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => void handleUpload(e)}
        />
      </label>
      <p className="mt-2 text-xs text-slate-400">支持 mp3 / wav / webm / m4a</p>
    </div>
  );
}
