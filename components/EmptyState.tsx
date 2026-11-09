import { PlusIcon, WaveIcon } from "@/components/Icons";
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="stagger-item flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-16 text-center">
      <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <WaveIcon className="h-9 w-9" />
        <span className="pulse-ring absolute inset-0 rounded-2xl border border-brand-300" />
      </div>
      <p className="text-base font-semibold text-slate-800">还没有录音</p>
      <p className="mt-1.5 text-sm text-slate-500">
        用手机录音机录完传上来，或者在这里直接录一段
      </p>
      <Link
        href="/record"
        className="pressable mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
      >
        <PlusIcon className="h-4 w-4" />
        开始录音
      </Link>
    </div>
  );
}
