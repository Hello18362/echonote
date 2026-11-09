import { cn } from "@/lib/cn";
import { STATUS_LABEL, type RecordingStatus } from "@/lib/types";

const STYLES: Record<RecordingStatus, string> = {
  pending: "bg-slate-100 text-slate-500",
  transcribing: "bg-brand-50 text-brand-600",
  summarizing: "bg-brand-50 text-brand-600",
  done: "bg-emerald-50 text-emerald-600",
  error: "bg-red-50 text-red-600",
};

export function StatusBadge({
  status,
  className,
}: {
  status: RecordingStatus;
  className?: string;
}) {
  const busy = status === "transcribing" || status === "summarizing" || status === "pending";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        STYLES[status] ?? STYLES.pending,
        className,
      )}
    >
      {busy ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
