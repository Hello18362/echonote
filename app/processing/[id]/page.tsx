import Link from "next/link";
import { ProcessingPanel } from "@/components/ProcessingPanel";
import { ArrowLeftIcon } from "@/components/Icons";

export const metadata = { title: "处理中 · EchoNote" };

export default function ProcessingPage({ params }: { params: { id: string } }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">
      <Link
        href="/"
        className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        返回列表
      </Link>

      <div className="mt-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">正在处理</h1>
        <p className="mt-2 text-sm text-slate-500">转写与纪要生成会依次完成</p>
      </div>

      <div className="mt-8">
        <ProcessingPanel id={params.id} />
      </div>
    </main>
  );
}
