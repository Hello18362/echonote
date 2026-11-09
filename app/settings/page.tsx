"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  RefreshIcon,
  UploadIcon,
} from "@/components/Icons";
import { cn } from "@/lib/cn";

type Source = "db" | "env" | "none";

type ProviderState = {
  baseUrl: string;
  model: string;
  source: Source;
  ready: boolean;
  keyMask: string;
};

type Snapshot = {
  asr: ProviderState;
  llm: ProviderState;
  audio: { count: number; bytes: number };
  /** 磁盘上有、数据库里已经没有对应记录的音频文件 */
  orphan?: { count: number; bytes: number };
  /** 设置了 ACCESS_PASSWORD 才为 true，此时才显示退出登录 */
  accessGate?: boolean;
};

type ProbeState = { pending: boolean; ok?: boolean; detail?: string; models?: string[] };

/**
 * 语音识别预置。只放「真的支持 OpenAI 兼容 /audio/transcriptions」的服务：
 * - 阿里百炼的 compatible-mode 没有这个路径（实测 404），paraformer-v2 要走原生接口，所以不放预置
 * - 智谱 glm-asr-2512 单段限制 25MB / 30 秒，长录音会失败，标签里写明
 */
const ASR_PRESETS = [
  { label: "硅基流动（免费）", baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/SenseVoiceSmall" },
  { label: "智谱（单段≤30 秒）", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-asr-2512" },
];

/** 大模型预置只填地址，模型名让「列出可用模型」来选，避免写死一个过期模型名 */
const LLM_PRESETS = [
  { label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "" },
  { label: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "" },
  { label: "阿里百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "" },
];

function sourceLabel(s: Source): string {
  if (s === "db") return "来自应用内设置";
  if (s === "env") return "来自 .env";
  return "未配置";
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [asrBase, setAsrBase] = useState("");
  const [asrKey, setAsrKey] = useState("");
  const [asrModel, setAsrModel] = useState("");
  const [llmBase, setLlmBase] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");

  const [probe, setProbe] = useState<Record<"asr" | "llm", ProbeState>>({
    asr: { pending: false },
    llm: { pending: false },
  });
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((data: Snapshot) => {
    setSnapshot(data);
    setAsrBase(data.asr.baseUrl);
    setAsrModel(data.asr.model);
    setLlmBase(data.llm.baseUrl);
    setLlmModel(data.llm.model);
    setAsrKey("");
    setLlmKey("");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("读取失败");
        const data = (await res.json()) as Snapshot;
        if (alive) apply(data);
      } catch {
        if (alive) setLoadError("读取当前配置失败，请刷新页面重试");
      }
    })();
    return () => {
      alive = false;
    };
  }, [apply]);

  const runProbe = async (target: "asr" | "llm" | "models") => {
    const key = target === "llm" ? "llm" : "asr";
    setProbe((p) => ({ ...p, [key]: { pending: true } }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          baseUrl: key === "asr" ? asrBase : llmBase,
          apiKey: key === "asr" ? asrKey : llmKey,
          model: key === "asr" ? asrModel : llmModel,
        }),
      });
      const data = (await res.json()) as { ok: boolean; detail?: string; models?: string[] };
      setProbe((p) => ({
        ...p,
        [key]: { pending: false, ok: data.ok, detail: data.detail, models: data.models },
      }));
    } catch {
      setProbe((p) => ({ ...p, [key]: { pending: false, ok: false, detail: "网络异常，未能完成测试" } }));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asr: { baseUrl: asrBase, apiKey: asrKey, model: asrModel },
          llm: { baseUrl: llmBase, apiKey: llmKey, model: llmModel },
        }),
      });
      const data = (await res.json()) as Snapshot & { error?: string };
      if (!res.ok) throw new Error(data.error || "保存失败");
      apply(data);
      toast("已保存，立即生效");
    } catch (err) {
      toast(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  /** 导入备份：整份 JSON 交给服务端逐条 upsert */
  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; created?: number; updated?: number; skipped?: number }
        | null;

      if (!res.ok) throw new Error(data?.error ?? "导入失败");

      const parts = [`新增 ${data?.created ?? 0} 条`, `更新 ${data?.updated ?? 0} 条`];
      if (data?.skipped) parts.push(`跳过 ${data.skipped} 条`);
      toast(`导入完成：${parts.join("，")}`);

      // 只刷新快照统计；不要走 apply，否则会把用户刚填还没保存的 Key 清空
      const snap = await fetch("/api/settings", { cache: "no-store" });
      if (snap.ok) setSnapshot((await snap.json()) as Snapshot);
    } catch (err) {
      toast(err instanceof Error ? err.message : "导入失败", "error");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  /** 清理孤儿音频（删除时被占用没删掉的残留） */
  const pruneAudio = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prune-audio" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { removed?: number; failed?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "清理失败");

      const tip = data?.failed
        ? `清理了 ${data?.removed ?? 0} 个，${data.failed} 个被占用未删掉`
        : `已清理 ${data?.removed ?? 0} 个音频文件`;
      toast(tip);

      const snap = await fetch("/api/settings", { cache: "no-store" });
      if (snap.ok) setSnapshot((await snap.json()) as Snapshot);
    } catch (err) {
      toast(err instanceof Error ? err.message : "清理失败", "error");
    } finally {
      setCleaning(false);
    }
  };

  const clearAll = async () => {
    const res = await fetch("/api/settings", { method: "DELETE" });
    if (!res.ok) throw new Error("清除失败");
    const data = (await res.json()) as Snapshot;
    apply(data);
  };

  /**
   * 退出访问口令。手机上把笔记分享给别人看设备时用得上；
   * 退出后 cookie 清空，会重新要求输入口令。
   */
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">
        <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-600">{loadError}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">
      <Link
        href="/"
        className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        返回列表
      </Link>

      <header className="stagger-item mt-4">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-slate-900 sm:text-[40px]">设置</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          配置语音识别与大模型。保存后<strong className="font-medium text-slate-700">立即生效</strong>
          ，不需要改文件、也不需要重启服务。
        </p>
      </header>

      <ProviderCard
        title="语音识别"
        subtitle="负责把录音转成文字。必须用专门的语音模型，对话模型不能代替。"
        state={snapshot?.asr}
        base={asrBase}
        onBase={setAsrBase}
        apiKey={asrKey}
        onApiKey={setAsrKey}
        model={asrModel}
        onModel={setAsrModel}
        modelHint="必须是语音模型。硅基流动免费、单段≤1 小时；智谱单段仅 30 秒"
        presets={ASR_PRESETS}
        onPreset={(p) => {
          setAsrBase(p.baseUrl);
          if (p.model) setAsrModel(p.model);
        }}
        probe={probe.asr}
        onProbe={() => void runProbe("asr")}
        onModels={() => void runProbe("models")}
      />

      <ProviderCard
        title="大模型"
        subtitle="负责把逐字稿写成摘要、待办和关键词。用你现在的中转站即可。"
        state={snapshot?.llm}
        base={llmBase}
        onBase={setLlmBase}
        apiKey={llmKey}
        onApiKey={setLlmKey}
        model={llmModel}
        onModel={setLlmModel}
        modelHint="选完地址和 Key 后点「列出可用模型」，从列表里点一个填进来"
        presets={LLM_PRESETS}
        onPreset={(p) => {
          setLlmBase(p.baseUrl);
          if (p.model) setLlmModel(p.model);
        }}
        probe={probe.llm}
        onProbe={() => void runProbe("llm")}
        onModels={() => void runProbe("models")}
      />

      <div className="stagger-item mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <Button onClick={() => void save()} disabled={saving || !snapshot}>
          {saving ? "保存中…" : "保存设置"}
        </Button>
        <Button variant="outline" onClick={() => setClearOpen(true)} disabled={!snapshot}>
          清除应用内配置
        </Button>
        <p className="text-xs text-slate-400">
          清除后回退到 <code className="font-mono">.env</code>；两边都没配就走演示模式。
        </p>
      </div>

      <section className="stagger-item mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 text-xs leading-relaxed text-slate-500 shadow-card">
        <p className="text-sm font-medium text-slate-800">存储与隐私</p>
        <p className="mt-2">
          音频文件保存在本机 <code className="font-mono">data/audio/</code>，当前{" "}
          {snapshot ? `${snapshot.audio.count} 个文件 · ${fmtBytes(snapshot.audio.bytes)}` : "统计中…"}
          。录音保留到对应记录被删除为止，方便随时重新处理。
        </p>
        <p className="mt-2">
          密钥只保存在本机数据库，页面只显示掩码；不会发往除你填写的那家服务之外的任何地方。
        </p>
        <p className="mt-2">
          两栏都要配齐才会真正转写。只配一栏，仍然会出现
          <strong className="font-medium text-slate-700">「演示数据」</strong>
          横幅——那说明这一环还在走内置示例。语音识别必须是语音模型（如 SenseVoice、GLM-ASR），
          对话模型顶不上；阿里百炼的百炼兼容接口不提供语音转写，填了会 404。
        </p>

        {snapshot?.orphan && snapshot.orphan.count > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800">
            <span className="flex-1">
              发现 <strong className="font-semibold">{snapshot.orphan.count}</strong> 个没有对应记录的音频文件（
              {fmtBytes(snapshot.orphan.bytes)}）。通常是删除那一刻文件被浏览器占用、没删干净，清掉即可。
            </span>
            <button
              type="button"
              onClick={() => void pruneAudio()}
              disabled={cleaning}
              className="pressable inline-flex h-8 items-center rounded-lg bg-white px-3 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 disabled:opacity-60"
            >
              {cleaning ? "清理中…" : "清理"}
            </button>
          </div>
        ) : null}

        {snapshot?.accessGate ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
            <span className="flex-1">
              已开启访问口令，这台设备 30 天内免输（网站地址不变时）。把手机递给别人看之前，先退出。
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="pressable inline-flex h-8 items-center rounded-lg bg-white px-3 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
            >
              退出登录
            </button>
          </div>
        ) : null}
      </section>

      <section
        id="data"
        className="stagger-item mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card"
      >
        <p className="text-sm font-medium text-slate-800">备份与恢复</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          导出的 JSON 含全部文字内容（逐字稿、纪要、待办、标签），
          <strong className="font-medium text-slate-700">但不含音频文件</strong>
          。换电脑或重装时，先在旧机器导出，再到新机器的这一页导入即可。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href="/api/export?format=json"
            className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <DownloadIcon className="h-4 w-4" />
            导出 JSON
          </a>
          <a
            href="/api/export?format=md"
            className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <DownloadIcon className="h-4 w-4" />
            导出 Markdown
          </a>
          <Button
            variant="outline"
            onClick={() => importRef.current?.click()}
            disabled={importing}
          >
            <UploadIcon className="h-4 w-4" />
            {importing ? "导入中…" : "从 JSON 恢复"}
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          同 id 的记录会被备份里的内容覆盖；导入的记录没有音频，不能再「重新处理」，但可以编辑和分享。
        </p>
      </section>

      <ConfirmDialog
        open={clearOpen}
        title="清除应用内配置？"
        description="将删除这里保存的地址与密钥，回退到 .env 中的配置。已生成的笔记不受影响。"
        onClose={() => setClearOpen(false)}
        onConfirm={clearAll}
        onDone={() => toast("已清除，回退到 .env")}
      />
    </main>
  );
}

type CardProps = {
  title: string;
  subtitle: string;
  state?: ProviderState;
  base: string;
  onBase: (v: string) => void;
  apiKey: string;
  onApiKey: (v: string) => void;
  model: string;
  onModel: (v: string) => void;
  modelHint: string;
  presets: Array<{ label: string; baseUrl: string; model: string }>;
  onPreset: (p: { label: string; baseUrl: string; model: string }) => void;
  probe: ProbeState;
  onProbe: () => void;
  onModels: () => void;
};

function ProviderCard({
  title,
  subtitle,
  state,
  base,
  onBase,
  apiKey,
  onApiKey,
  model,
  onModel,
  modelHint,
  presets,
  onPreset,
  probe,
  onProbe,
  onModels,
}: CardProps) {
  const statusText = state ? sourceLabel(state.source) : "读取中…";
  const ready = state?.ready ?? false;

  return (
    <section className="stagger-item mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
            ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
          )}
        >
          {ready ? "已配置" : "未配置"}
          {state && state.source !== "none" ? ` · ${statusText}` : ""}
        </span>
      </div>

      {presets.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onPreset(p)}
              className="pressable rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-3.5">
        <Field label="服务地址" hint="要填到 /v1 或 /v4 为止，程序会自动拼接接口路径">
          <input
            value={base}
            onChange={(e) => onBase(e.target.value)}
            placeholder="https://api.example.com/v1"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors duration-200 placeholder:text-slate-300 focus:border-brand-500"
          />
        </Field>

        <Field
          label="API Key"
          hint={state?.keyMask ? `当前已保存：${state.keyMask}，留空则不修改` : "没有配置过，留空则不修改"}
        >
          <input
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
            placeholder="sk-..."
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-800 outline-none transition-colors duration-200 placeholder:text-slate-300 focus:border-brand-500"
          />
        </Field>

        <Field label="模型" hint={modelHint}>
          <input
            value={model}
            onChange={(e) => onModel(e.target.value)}
            placeholder="模型名称"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-800 outline-none transition-colors duration-200 placeholder:text-slate-300 focus:border-brand-500"
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onProbe} disabled={probe.pending}>
          <RefreshIcon className={cn("h-4 w-4", probe.pending && "animate-spin-slow")} />
          {probe.pending ? "测试中…" : "测试连接"}
        </Button>
        <Button variant="ghost" onClick={onModels} disabled={probe.pending}>
          列出可用模型
        </Button>
      </div>

      {probe.detail ? (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed",
            probe.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600",
          )}
        >
          {probe.ok ? (
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="break-all">{probe.detail}</span>
        </div>
      ) : null}

      {probe.models?.length ? (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-3">
          <p className="mb-1.5 text-xs text-slate-400">点一下即可填入模型名：</p>
          <div className="flex flex-wrap gap-1.5">
            {probe.models.slice(0, 60).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModel(m)}
                className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-brand-700 hover:ring-brand-500"
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <span className="whitespace-nowrap text-sm font-medium text-slate-700">{label}</span>
        <span className="text-[11px] leading-relaxed text-slate-400">{hint}</span>
      </span>
      {children}
    </label>
  );
}
