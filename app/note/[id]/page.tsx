import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { EditableTitle } from "@/components/EditableTitle";
import { EditableSection } from "@/components/EditableSection";
import { TagEditor } from "@/components/TagEditor";
import { AudioPlayer } from "@/components/AudioPlayer";
import { MarkdownView } from "@/components/MarkdownView";
import { TodoList } from "@/components/TodoList";
import { NoteActions } from "@/components/NoteActions";
import { SharedPanel } from "@/components/SharedPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeftIcon, AlertIcon } from "@/components/Icons";
import { formatDateTime, formatDuration } from "@/lib/format";
import { audioInfo } from "@/lib/audioStore";
import { parseNumberArray, parseStringArray } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: { id: string } }) {
  let record = null;
  try {
    record = await prisma.recording.findUnique({ where: { id: params.id } });
  } catch (err) {
    console.error("[note] 读取失败", err);
  }

  if (!record) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-10 sm:px-6">
        <div className="stagger-item rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-800">记录不存在</p>
          <p className="mt-1.5 text-sm text-slate-500">这条录音可能已经被删除了</p>
          <Link
            href="/"
            className="pressable mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 text-sm font-medium text-white"
          >
            返回首页
          </Link>
        </div>
      </main>
    );
  }

  const todos = parseStringArray(record.todos);
  const todosDone = parseNumberArray(record.todosDone);
  const keyPoints = parseStringArray(record.keyPoints);
  const tags = parseStringArray(record.tags);
  const createdAtLabel = formatDateTime(record.createdAt);
  const durationLabel = formatDuration(record.duration);
  const status = record.status as "pending" | "transcribing" | "summarizing" | "done" | "error";
  const processing = status !== "done";

  // 音频文件可能被手动清理过，先确认存在再渲染播放器
  let hasAudioFile = false;
  try {
    hasAudioFile = audioInfo(record.id).exists;
  } catch {
    hasAudioFile = false;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">
      <Link
        href="/"
        className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        返回列表
      </Link>

      <SharedPanel id={record.id} className="mt-4">
        {/* 顶部信息区 */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <EditableTitle id={record.id} initial={record.title} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{createdAtLabel}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>时长 {durationLabel}</span>
                <StatusBadge status={status} className="ml-1" />
                {record.edited ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    已手动编辑
                  </span>
                ) : null}
              </div>
            </div>
            <NoteActions
              id={record.id}
              title={record.title}
              createdAtLabel={createdAtLabel}
              durationLabel={durationLabel}
              summary={record.summary ?? ""}
              todos={todos}
              todosDone={todosDone}
              keyPoints={keyPoints}
              transcript={record.transcript ?? ""}
              tags={tags}
              processing={processing}
              mock={record.mock}
              failed={status === "error"}
            />
          </div>

          <div className="mt-4 border-t border-slate-100 pt-1">
            <TagEditor id={record.id} initial={tags} />
          </div>

          {record.mock ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">
                <strong className="font-semibold">这是演示数据，与你的录音无关。</strong>
                当前没有配置语音识别 / 大模型服务，下面的逐字稿和纪要都是内置示例。到
                <Link href="/settings" className="mx-1 font-medium underline underline-offset-2">
                  设置页
                </Link>
                填好服务与 Key 后，点「重新处理」即可用原音频重新生成真实结果。
              </span>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">
                处理失败：{record.error || "未知错误"}。可点击右上角「重新处理」重试。
              </span>
            </div>
          ) : null}

          {status === "pending" || status === "transcribing" || status === "summarizing" ? (
            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
              还在处理中，可以前往
              <Link href={`/processing/${record.id}`} className="mx-1 font-medium underline">
                处理页
              </Link>
              查看进度。
            </div>
          ) : null}
        </section>

        {hasAudioFile ? (
          <div className="mt-5">
            <AudioPlayer id={record.id} durationLabel={durationLabel} />
          </div>
        ) : null}

        {/* 会议纪要独占整行：分节 + 表格，挤在窄栏里读不动 */}
        <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
          <EditableSection
            id={record.id}
            field="summary"
            label="会议纪要"
            initial={record.summary ?? ""}
            rows={22}
            placeholder="还没有纪要，可以自己写，支持 Markdown（## 标题 / - 列表 / 表格）"
            hint="AI 生成的纪要，可以直接改；改完点保存"
          >
            <div className="mt-3">
              <MarkdownView markdown={record.summary ?? ""} />
            </div>
          </EditableSection>
        </section>

        {/* 两栏：桌面左右，手机上下 */}
        <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <section className="order-2 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6 lg:order-1">
            <EditableSection
              id={record.id}
              field="transcript"
              label="逐字稿"
              initial={record.transcript ?? ""}
              rows={16}
              placeholder="这段录音还没有逐字稿，可以直接在这里输入或粘贴。"
              hint="识别错的地方可以直接改，改完会自动保存到本地"
            >
              <div className="thin-scroll mt-3 max-h-[520px] overflow-y-auto pr-1">
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">
                  {record.transcript || "（暂无逐字稿）"}
                </p>
              </div>
            </EditableSection>
          </section>

          <aside className="order-1 space-y-5 lg:order-2">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
              <EditableSection
                id={record.id}
                field="todos"
                label="待办清单"
                mode="lines"
                initial={todos}
                rows={Math.max(5, Math.min(14, todos.length + 2))}
                placeholder={"每行一条待办，例如：\n周三前把方案发给老王"}
                hint={todos.length ? "勾选状态会保存，编辑条目后原有勾选会按顺序保留" : undefined}
              >
                <div className="mt-3">
                  <TodoList
                    key={`${todos.length}-${todos.join("|")}`}
                    id={record.id}
                    todos={todos}
                    initialDone={todosDone}
                  />
                </div>
              </EditableSection>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
              <EditableSection
                id={record.id}
                field="keyPoints"
                label="关键词"
                mode="lines"
                initial={keyPoints}
                rows={Math.max(4, Math.min(12, keyPoints.length + 2))}
                placeholder={"每行一个关键词"}
              >
                <div className="mt-3 flex flex-wrap gap-2">
                  {keyPoints.length ? (
                    keyPoints.map((k, i) => (
                      <span
                        key={`${i}-${k}`}
                        className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors duration-200 hover:bg-brand-100"
                      >
                        {k}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-400">（暂无关键词）</span>
                  )}
                </div>
              </EditableSection>
            </section>
          </aside>
        </div>
      </SharedPanel>
    </main>
  );
}
