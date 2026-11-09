import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownView } from "@/components/MarkdownView";
import { formatDateTime, formatDuration } from "@/lib/format";
import { parseNumberArray, parseStringArray } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // 分享链接不该被搜索引擎收录：令牌本身就是访问凭证
  const noindex = { index: false, follow: false } as const;
  try {
    const record = await prisma.recording.findUnique({
      where: { shareToken: params.token },
      select: { title: true, summary: true },
    });
    if (!record) return { title: "分享已失效 · EchoNote", robots: noindex };
    return {
      title: `${record.title} · EchoNote`,
      description: (record.summary ?? "").slice(0, 120),
      robots: noindex,
    };
  } catch {
    return { title: "EchoNote", robots: noindex };
  }
}

/**
 * 只读分享页：拿到链接的人只能看。
 * 没有编辑、删除、导出入口，也不提供音频（避免分享语音本身）。
 */
export default async function SharedNotePage({ params }: Props) {
  let record = null;
  try {
    record = await prisma.recording.findUnique({
      where: { shareToken: params.token },
    });
  } catch (err) {
    console.error("[share] 读取失败", err);
  }

  if (!record) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-16 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-800">这个分享链接已经失效</p>
          <p className="mt-1.5 text-sm text-slate-500">
            笔记可能被删除，或者分享者主动关闭了分享。
          </p>
          <Link
            href="/"
            className="pressable mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 text-sm font-medium text-white"
          >
            打开 EchoNote
          </Link>
        </div>
      </main>
    );
  }

  const todos = parseStringArray(record.todos);
  const todosDone = new Set(parseNumberArray(record.todosDone));
  const keyPoints = parseStringArray(record.keyPoints);
  const tags = parseStringArray(record.tags);
  const status = record.status as "pending" | "transcribing" | "summarizing" | "done" | "error";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-slate-900">EchoNote</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            只读分享
          </span>
        </div>
        <Link href="/" className="text-xs font-medium text-brand-600 hover:underline">
          打开应用
        </Link>
      </header>

      <article className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-7">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {record.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{formatDateTime(record.createdAt)}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>时长 {formatDuration(record.duration)}</span>
          <StatusBadge status={status} className="ml-1" />
        </div>

        {tags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {record.mock ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            这份笔记的内容是演示数据，与录音无关。
          </p>
        ) : null}

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">会议纪要</h2>
          <div className="mt-2">
            <MarkdownView markdown={record.summary ?? ""} />
          </div>
        </section>

        {todos.length ? (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">待办清单</h2>
            <ul className="mt-2 space-y-1.5">
              {todos.map((todo, i) => {
                const done = todosDone.has(i);
                return (
                  <li key={`${i}-${todo}`} className="flex items-start gap-2.5 text-sm leading-6">
                    <span
                      aria-hidden
                      className={
                        done
                          ? "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-[10px] text-white"
                          : "mt-1 h-4 w-4 shrink-0 rounded border border-slate-300"
                      }
                    >
                      {done ? "✓" : ""}
                    </span>
                    <span className={done ? "text-slate-400 line-through" : "text-slate-700"}>
                      {todo}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">逐字稿</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">
            {record.transcript || "（暂无逐字稿）"}
          </p>
        </section>

        {keyPoints.length ? (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">关键词</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {keyPoints.map((k, i) => (
                <span
                  key={`${i}-${k}`}
                  className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                >
                  {k}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </article>

      <p className="mt-6 text-center text-xs text-slate-400">
        由 EchoNote 分享 · 只读，不可编辑
      </p>
    </main>
  );
}
