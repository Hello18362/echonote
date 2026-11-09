"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type MouseEvent } from "react";
import { StatusBadge } from "./StatusBadge";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";
import { useSelection } from "./SelectionProvider";
import { TrashIcon, CheckIcon } from "./Icons";
import { setOrigin } from "@/lib/transition";
import { cn } from "@/lib/cn";
import type { RecordingStatus } from "@/lib/types";

type Props = {
  id: string;
  title: string;
  durationLabel: string;
  createdAtLabel: string;
  summary: string;
  status: RecordingStatus;
  index: number;
  /** 内容是否来自内置示例 */
  mock: boolean;
  /** 用户标签 */
  tags: string[];
};

export function RecordingCard({
  id,
  title,
  durationLabel,
  createdAtLabel,
  summary,
  status,
  index,
  mock,
  tags,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const cardRef = useRef<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 删除成功后立刻从列表移除，不用等服务端整页刷新回来 */
  const [removed, setRemoved] = useState(false);
  const { active, isSelected, toggle } = useSelection();
  const selected = isSelected(id);

  const target =
    status === "done" || status === "error" ? `/note/${id}` : `/processing/${id}`;

  // 03-05 共享元素转场：记录卡片原位，详情页从该位置展开
  const captureOrigin = () => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOrigin(id, { top: r.top, left: r.left, width: r.width, height: r.height });
  };

  const handleCardClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // 多选模式下，点卡片是勾选而不是进详情
    if (active) {
      e.preventDefault();
      toggle(id);
      return;
    }
    captureOrigin();
  };

  // 04-13 3D 倾斜光影（仅支持 hover 的设备）
  const handleMove = (e: MouseEvent<HTMLElement>) => {
    if (active) return;
    const el = cardRef.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
    el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 5}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-2px)`;
  };

  const handleLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = "";
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("删除失败");
  };

  if (removed) return null;

  return (
    <>
      <article
        ref={cardRef}
        data-recording-id={id}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ ["--i" as string]: index }}
        className={cn(
          "stagger-item tilt-3d group relative rounded-2xl border bg-white p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200",
          active
            ? selected
              ? "border-brand-400 ring-2 ring-brand-200"
              : "border-slate-200/80 hover:border-brand-200"
            : "border-slate-200/80 hover:border-slate-300 hover:shadow-card-hover",
        )}
      >
        <Link
          href={target}
          onClick={handleCardClick}
          aria-label={active ? `${selected ? "取消选择" : "选择"} ${title}` : `打开 ${title}`}
          aria-pressed={active ? selected : undefined}
          className="absolute inset-0 z-0 rounded-2xl"
        />

        {active ? (
          <span
            aria-hidden
            className={cn(
              "absolute left-4 top-4 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-150",
              selected
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-300 bg-white",
            )}
          >
            {selected ? <CheckIcon className="h-3 w-3" /> : null}
          </span>
        ) : null}

        <div className={cn("pointer-events-none relative z-10", active && "pl-7")}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-1 flex-1 text-[15px] font-semibold text-slate-900">
              {title}
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {mock ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                  演示
                </span>
              ) : null}
              <StatusBadge status={status} />
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span>{createdAtLabel}</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{durationLabel}</span>
          </div>

          <p className="mt-3 line-clamp-2 min-h-[40px] pr-9 text-sm leading-relaxed text-slate-500">
            {summary || (status === "error" ? "处理失败，可进入详情页重试" : "暂无摘要")}
          </p>

          {tags.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1 pr-9">
              {tags.slice(0, 3).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  // 内容层整体 pointer-events-none，标签要单独恢复点击，否则只能靠外层 Link
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (active) {
                      toggle(id);
                      return;
                    }
                    router.push(`/?tag=${encodeURIComponent(tag)}`);
                  }}
                  className="pointer-events-auto relative z-20 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                >
                  {tag}
                </button>
              ))}
              {tags.length > 3 ? (
                <span className="text-[11px] text-slate-400">+{tags.length - 3}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="删除这条录音"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          className={cn(
            // 44px 才能满足移动端触控标准（之前 36px 手指容易点空）
            "pressable absolute bottom-2.5 right-2.5 z-20 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 opacity-100 transition-opacity duration-200 hover:bg-red-50 hover:text-red-500 focus-visible:opacity-100 active:scale-95 sm:text-slate-300 sm:opacity-0 sm:group-hover:opacity-100",
            active && "hidden",
          )}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </article>

      <ConfirmDialog
        open={confirmOpen}
        title="删除这条录音？"
        description="删除后无法恢复，相关的逐字稿和纪要也会一起消失。"
        confirmText="确认删除"
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        onDone={() => {
          setRemoved(true);
          toast("已删除");
          router.refresh();
        }}
      />
    </>
  );
}
