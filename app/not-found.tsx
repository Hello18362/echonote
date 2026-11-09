import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-5xl font-bold tracking-tight text-slate-200">404</p>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">这个页面不存在</h1>
      <p className="mt-2 text-sm text-slate-500">链接可能已失效，或者记录被删除了</p>
      <Link
        href="/"
        className="pressable mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
      >
        返回首页
      </Link>
    </main>
  );
}
