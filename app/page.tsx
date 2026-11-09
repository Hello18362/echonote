import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RecordingCard } from "@/components/RecordingCard";
import { RecordingToolbar } from "@/components/RecordingToolbar";
import { SelectionProvider } from "@/components/SelectionProvider";
import { QuickUpload } from "@/components/QuickUpload";
import { InboxHint } from "@/components/InboxHint";
import { EmptyState } from "@/components/EmptyState";
import { PlusIcon, SettingsIcon, DownloadIcon, SearchIcon } from "@/components/Icons";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getAppConfig, isProviderReady } from "@/lib/config";
import { buildOrderBy, buildWhere, normalizeQuery, type ListQuery } from "@/lib/query";
import { recoverStuckRecordings } from "@/lib/recover";
import { parseStringArray, type RecordingStatus } from "@/lib/types";
import { INBOX_DIR } from "@/lib/inbox";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-10 sm:px-6 sm:pt-14">
      <header className="stagger-item flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              EchoNote
            </h1>
            {mockMode ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
                Mock 模式
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-500">录音转文字，自动生成结构化纪要</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="pressable inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-900"
          >
            <SettingsIcon className="h-4 w-4" />
            设置
          </Link>

          <QuickUpload />

          <Link
            href="/record"
            className="pressable relative inline-flex min-h-[44px] items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-sm transition-colors duration-200 hover:bg-brand-700"
          >
            <PlusIcon className="h-4 w-4" />
            新建录音
          </Link>
        </div>
      </header>

      {/* 手机上放不进电脑文件夹，这条只对电脑端有意义 */}
      <div className="hidden sm:block">
        <InboxHint dir={INBOX_DIR} />
      </div>

      <section className="mt-8">
        {dbError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-600">
            数据库读取失败，请确认已执行 <code className="font-mono">npx prisma db push</code>。
          </div>
        ) : totalAll === 0 ? (
          <EmptyState />
        ) : (
          <SelectionProvider>
            <RecordingToolbar total={rows.length} query={query} />

            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                  <SearchIcon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-700">没有匹配的记录</p>
                <p className="mt-1 text-xs text-slate-400">
                  换个关键词，或把筛选条件改回「全部」
                </p>
                <Link
                  href="/"
                  className="pressable mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  清除筛选
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((row, index) => (
                  <RecordingCard
                    key={row.id}
                    id={row.id}
                    index={index}
                    title={row.title}
                    durationLabel={formatDuration(row.duration)}
                    createdAtLabel={formatDateTime(row.createdAt)}
                    summary={row.summary ?? ""}
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

      <footer className="mt-16 flex flex-col items-center gap-3 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href="/api/export?format=json"
            className="pressable inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            备份全部(JSON)
          </a>
          <a
            href="/api/export?format=md"
            className="pressable inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            导出全部(Markdown)
          </a>
        </div>
        <p className="text-xs text-slate-400">
          数据保存在本机 SQLite，刷新不丢失
          {filtering ? " · 当前为筛选结果，导出的是全部记录" : ""}
        </p>
      </footer>
    </main>
  );
}
