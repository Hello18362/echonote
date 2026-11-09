"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { useToast } from "@/components/ui/Toast";
import {
  DownloadIcon,
  RefreshIcon,
  ShareIcon,
  SparkleIcon,
  TrashIcon,
} from "@/components/Icons";
import { buildRecordingMarkdown, safeFileName } from "@/lib/markdown";

type Props = {
  id: string;
  title: string;
  createdAtLabel: string;
  durationLabel: string;
  summary: string;
  todos: string[];
  todosDone: number[];
  keyPoints: string[];
  transcript: string;
  tags: string[];
  processing: boolean;
  /** 内容是演示数据时，也允许"重新处理"（配置好模型后需要） */
  mock: boolean;
  /** 处理失败时把"重新处理"提到主按钮 */
  failed: boolean;
};

export function NoteActions({
  id,
  title,
  createdAtLabel,
  durationLabel,
  summary,
  todos,
  todosDone,
  keyPoints,
  transcript,
  tags,
  processing,
  mock,
  failed,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"docx" | null>(null);

  const hasTranscript = transcript.trim().length > 0;

  const handleExportMd = () => {
    setExportOpen(false);
    const md = buildRecordingMarkdown({
      title,
      createdAtLabel,
      durationLabel,
      summary,
      todos,
      todosDone,
      keyPoints,
      transcript,
      tags,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileName(title)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("已导出 Markdown");
  };

  /** Word 由服务端生成（真 .docx），文件名从响应头里取，中文不会乱码 */
  const handleExportDocx = async () => {
    if (exporting) return;
    setExporting("docx");
    try {
      const res = await fetch(`/api/recordings/${id}/export`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "导出失败");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const matched = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const fileName = matched
        ? decodeURIComponent(matched[1])
        : `${safeFileName(title)}.docx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportOpen(false);
      toast("已导出 Word 文档");
    } catch (err) {
      toast(err instanceof Error ? err.message : "导出失败，请重试", "error");
    } finally {
      setExporting(null);
    }
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("删除失败");
  };

  /** 整条重跑：重新转写 + 重新生成纪要 */
  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/recordings/${id}/process?force=1`, { method: "POST" });
      if (!res.ok) throw new Error("触发失败");
      router.push(`/processing/${id}`);
    } catch {
      toast("没能重新触发处理，请稍后再试", "error");
      setRetrying(false);
      throw new Error("触发失败");
    }
  };

  /** 只重跑摘要：逐字稿保持不动 */
  const handleSummaryOnly = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/recordings/${id}/process?stage=summary`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "提交失败");
      }
      router.push(`/processing/${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "提交失败，请稍后再试", "error");
      setRetrying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {processing ? (
        <Button variant="outline" onClick={() => router.push(`/processing/${id}`)}>
          <RefreshIcon className="h-4 w-4" />
          查看进度
        </Button>
      ) : (
        <>
          <Button
            variant={mock || failed ? "primary" : "outline"}
            onClick={() => setRetryOpen(true)}
            disabled={retrying}
          >
            <RefreshIcon className={retrying ? "h-4 w-4 animate-spin-slow" : "h-4 w-4"} />
            重新处理
          </Button>

          {hasTranscript ? (
            <Button variant="outline" onClick={() => void handleSummaryOnly()} disabled={retrying}>
              <SparkleIcon className="h-4 w-4" />
              只更新摘要
            </Button>
          ) : null}
        </>
      )}

      <Button variant="outline" onClick={() => setShareOpen(true)}>
        <ShareIcon className="h-4 w-4" />
        分享
      </Button>

      <div className="relative">
        <Button
          variant="outline"
          onClick={() => setExportOpen((v) => !v)}
          disabled={exporting !== null}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
        >
          <DownloadIcon className="h-4 w-4" />
          {exporting ? "生成中…" : "导出"}
        </Button>

        {exportOpen ? (
          <>
            {/* 点空白处收起 */}
            <div
              className="fixed inset-0 z-20"
              aria-hidden
              onClick={() => setExportOpen(false)}
            />
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleExportDocx()}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
              >
                <DownloadIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">Word 文档</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    分节纪要 + 逐字稿，.docx
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleExportMd}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
              >
                <DownloadIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">Markdown</span>
                  <span className="mt-0.5 block text-xs text-slate-400">纯文本，.md</span>
                </span>
              </button>
            </div>
          </>
        ) : null}
      </div>

      <Button variant="danger" onClick={() => setConfirmOpen(true)}>
        <TrashIcon className="h-4 w-4" />
        删除
      </Button>

      <ConfirmDialog
        open={retryOpen}
        title="重新处理这条录音？"
        description={
          mock
            ? "会用保存的原音频重新转写。如果还没在设置页填好模型，结果依然是演示数据。"
            : "会用保存的原音频重新转写并重新生成纪要，会消耗一次模型调用额度。手动改过的内容会被覆盖。"
        }
        confirmText="开始处理"
        danger={false}
        onClose={() => setRetryOpen(false)}
        onConfirm={async () => {
          await handleRetry();
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="删除这条笔记？"
        description="删除后无法恢复，相关的逐字稿、纪要和音频文件也会一起消失。"
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        onDone={() => {
          toast("已删除");
          router.push("/");
        }}
      />

      <ShareDialog id={id} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
