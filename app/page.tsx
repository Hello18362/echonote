import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RecordingCard } from "@/components/RecordingCard";
import { RecordingToolbar } from "@/components/RecordingToolbar";
import { SelectionProvider } from "@/components/SelectionProvider";
import { QuickUpload } from "@/components/QuickUpload";
import { InboxHint } from "@/components/InboxHint";
import { EmptyState } from "@/components/EmptyState";
import { SiteNav } from "@/components/SiteNav";
import { DownloadIcon, SearchIcon } from "@/components/Icons";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getAppConfig, isProviderReady } from "@/lib/config";
import { buildOrderBy, buildWhere, normalizeQuery, type ListQuery } from "@/lib/query";
import { recoverStuckRecordings } from "@/lib/recover";
import { parseStringArray, type RecordingStatus } from "@/lib/types";
import { INBOX_DIR } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * 卡片只放纯文本预览。
 * summary 是 Markdown，直接塞进卡片会露出 "## 会议概要"、"**粗体**" 这类标记，
 * 列表页看起来就像没渲染的源码 —— 在服务端先抹掉，卡片里只留内容。
 */
function plainPreview(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Row = {
  id: string;
  title: string;
  duration: number;
  status: string;
  summary: string | null;
  mock: boolean;
  tags: string | null;
  createdAt: Date;
};

async function loadRows(query: ListQuery): Promise<{
  rows: Row[];
  totalAll: number;
  dbError: boolean;
}> {
  try {
    // 先修上次进程遗留的「处理中」，否则卡片上是转不完的圈
    await recoverStuckRecordings();

    const [rows, totalAll] = await Promise.all([
      prisma.recording.findMany({
        where: buildWhere(query),
        orderBy: buildOrderBy(query),
        select: {
          id: true,
          title: true,
          duration: true,
          status: true,
          summary: true,
          mock: true,
          tags: true,
          createdAt: true,
        },
      }),
      prisma.recording.count(),
    ]);

    return { rows, totalAll, dbError: false };
  } catch (err) {
    console.error("[page] 读取列表失败", err);
    return { rows: [], totalAll: 0, dbError: true };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; sort?: string; tag?: string };
}) {
  const query = normalizeQuery({
    q: searchParams.q,
    status: searchParams.status,
    sort: searchParams.sort,
    tag: searchParams.tag,
  });

  const [cfg, { rows, totalAll, dbError }] = await Promise.all([
    getAppConfig(),
    loadRows(query),
  ]);
  const mockMode = !isProviderReady(cfg.asr) || !isProviderReady(cfg.llm);

  const filtering =
    Boolean(query.q) || Boolean(query.tag) || (query.status ?? "all") !== "all";

  return (
    <>
      <SiteNav />

      <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-14 sm:px-6 sm:pt-20">
        {/* Hero：一句大标题 + 一句解释 + 两个按钮，苹果官网首屏就是这个节奏 */}
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-[56px]">
            录音，变成纪要。
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-slate-500 sm:text-[19px]">
            转写、摘要、待办，一次完成。
            <br className="hidden sm:block" />
            所有内容都留在你自己的电脑上。
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/record" className="btn-pill btn-primary h-11 px-6 text-[15px]">
              新建录音
            </Link>
            <QuickUpload className="h-11 px-6 text-[15px]" />
          </div>

          {mockMode ? (
            <p className="mt-5 text-[13px] text-slate-400">
              尚未配置转写服务，当前为演示模式
            </p>
          ) : null}
        </header>

        {/* 手机上放不进电脑文件夹，这条只对电脑端有意义 */}
        <div className="mt-14 hidden sm:block">
          <InboxHint dir={INBOX_DIR} />
        </div>

        <section className="mt-10">
          {dbError ? (
            <div className="rounded-2xl border border-red-100 bg-white p-6 text-center text-sm text-red-500">
              数据库读取失败，请确认已执行 <code className="font-mono">npx prisma db push</code>。
            </div>
          ) : totalAll === 0 ? (
            <EmptyState />
          ) : (
            <SelectionProvider>
              <RecordingToolbar total={rows.length} query={query} />

              {rows.length === 0 ? (
                <div className="rounded-3xl bg-white px-6 py-16 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                    <SearchIcon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-[15px] font-medium text-slate-900">没有匹配的记录</p>
                  <p className="mt-1.5 text-[13px] text-slate-400">
                    换个关键词，或把筛选条件改回「全部」
                  </p>
                  <Link
                    href="/"
                    className="btn-pill btn-secondary mt-6 h-9 px-4 text-[13px]"
                  >
                    清除筛选
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                  {rows.map((row, index) => (
                    <RecordingCard
                      key={row.id}
                      id={row.id}
                      index={index}
                      title={row.title}
                      durationLabel={formatDuration(row.duration)}
                      createdAtLabel={formatDateTime(row.createdAt)}
                      summary={plainPreview(row.summary ?? "")}
                      status={row.status as RecordingStatus}
                      mock={row.mock}
                      tags={parseStringArray(row.tags)}
                    />
                  ))}
                </div>
              )}
            </SelectionProvider>
          )}
        </section>

        <footer className="mt-20 border-t border-slate-200 pt-8 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px]">
            <a
              href="/api/export?format=json"
              className="inline-flex items-center gap-1.5 text-slate-500 transition-colors duration-200 hover:text-brand-600"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              备份全部（JSON）
            </a>
            <a
              href="/api/export?format=md"
              className="inline-flex items-center gap-1.5 text-slate-500 transition-colors duration-200 hover:text-brand-600"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              导出全部（Markdown）
            </a>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-slate-400">
            数据保存在本机 SQLite，刷新不丢失
            {filtering ? " · 当前为筛选结果，导出的是全部记录" : ""}
          </p>
        </footer>
      </main>
    </>
  );
}
