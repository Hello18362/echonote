"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { AlertIcon, RefreshIcon } from "@/components/Icons";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] 未捕获异常", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
        <AlertIcon className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-lg font-semibold text-slate-900">页面出了点问题</h1>
      <p className="mt-2 max-w-sm break-words text-sm leading-relaxed text-slate-500">
        {error.message || "未知错误，可以重试一次"}
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button onClick={reset}>
          <RefreshIcon className="h-4 w-4" />
          重试
        </Button>
        <Link
          href="/"
          className="pressable inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
