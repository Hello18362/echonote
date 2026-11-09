import Link from "next/link";

/**
 * 顶栏沿用 apple.com 的做法：44px 左右高、半透明毛玻璃、
 * 一条几乎看不见的分割线，文字很克制（13px），不放主要操作。
 * 主要操作留给页面里的 hero 区，这样首屏才有"大标题 + 一个按钮"的节奏。
 */
export function SiteNav() {
  return (
    <nav className="apple-nav">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-[-0.02em] text-slate-900 transition-opacity hover:opacity-70"
        >
          EchoNote
        </Link>

        <div className="flex items-center gap-0.5 text-[13px] text-slate-500">
          <Link
            href="/record"
            className="rounded-full px-3 py-1.5 transition-colors duration-200 hover:bg-black/[0.04] hover:text-slate-900"
          >
            录音
          </Link>
          <Link
            href="/settings"
            className="rounded-full px-3 py-1.5 transition-colors duration-200 hover:bg-black/[0.04] hover:text-slate-900"
          >
            设置
          </Link>
        </div>
      </div>
    </nav>
  );
}
