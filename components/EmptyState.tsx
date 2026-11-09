import { PlusIcon, WaveIcon } from "@/components/Icons";
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="stagger-item flex flex-col items-center justify-center rounded-3xl bg-white px-6 py-20 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <WaveIcon className="h-8 w-8" />
      </div>
      <p className="text-[19px] font-semibold tracking-tight text-slate-900">还没有录音</p>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-slate-500">
        用手机录音机录完传上来，或者在这里直接录一段
      </p>
      <Link
        href="/record"
        className="btn-pill btn-primary mt-7 h-11 gap-2 px-6 text-[15px]"
      >
        <PlusIcon className="h-4 w-4" />
        开始录音
      </Link>
    </div>
  );
}
