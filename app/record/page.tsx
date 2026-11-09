import Link from "next/link";
import { RecordButton } from "@/components/RecordButton";
import { ArrowLeftIcon } from "@/components/Icons";
import { getAppConfig, isProviderReady } from "@/lib/config";

export const metadata = { title: "录音 · EchoNote" };

export default async function RecordPage() {
  const cfg = await getAppConfig();
  const mockMode = !isProviderReady(cfg.asr) || !isProviderReady(cfg.llm);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">
      <Link
        href="/"
        className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        返回列表
      </Link>

      <div className="stagger-item mt-8 flex flex-col items-center text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          新建录音
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          录完自动转写并生成纪要，也可以直接上传已有音频
        </p>
      </div>

      <div className="mt-10">
        <RecordButton mockMode={mockMode} />
      </div>

      <details className="mx-auto mt-10 w-full max-w-md rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm open:shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-medium text-slate-700 marker:hidden">
          录不了音 / 提示「麦克风权限被拒绝」？点开看怎么开
        </summary>

        <div className="mt-3 space-y-4 text-xs leading-relaxed text-slate-500">
          <div>
            <p className="font-medium text-slate-700">① 先确认打开方式</p>
            <p className="mt-1">
              必须是独立浏览器标签页（地址栏完整可见）。如果在某个应用的
              <strong className="font-medium text-slate-700">内嵌预览窗口</strong>
              里打开，浏览器不会给麦克风权限，也不会弹授权框——把地址复制到 Chrome / Edge
              的标签页里打开即可。
            </p>
          </div>

          <div>
            <p className="font-medium text-slate-700">② Chrome / Edge 授权</p>
            <p className="mt-1">
              点地址栏<strong className="font-medium text-slate-700">最左侧的图标</strong>
              （锁形或两个滑块的图标）→「网站设置」→ 把「麦克风」改成
              <strong className="font-medium text-slate-700">允许</strong> → 刷新页面。
              第一次点录音时，浏览器顶部会弹出「要允许…使用你的麦克风吗」，选「允许」。
            </p>
          </div>

          <div>
            <p className="font-medium text-slate-700">③ 系统层面的开关</p>
            <p className="mt-1">
              Windows：设置 → 隐私和安全性 → 麦克风 → 打开「麦克风访问」与「允许桌面应用访问麦克风」。
            </p>
            <p className="mt-1">
              macOS：系统设置 → 隐私与安全性 → 麦克风 → 勾选你正在用的浏览器。
            </p>
          </div>

          <div>
            <p className="font-medium text-slate-700">④ 仍然不行</p>
            <p className="mt-1">
              换 Chrome / Edge 再试；确认麦克风没被会议软件（腾讯会议、飞书等）独占；也可以先用手机录音机录好，再用下面的「上传音频文件」导入。
            </p>
          </div>
        </div>
      </details>
    </main>
  );
}
