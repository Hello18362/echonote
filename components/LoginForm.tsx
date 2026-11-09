"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LockIcon } from "@/components/Icons";

/**
 * 访问口令输入页。只有一个输入框 —— 这不是账号系统，是门上的一把锁。
 *
 * autoToken 是启动器打在二维码里的当天令牌：扫进来时自动换 cookie 直接进，
 * 输入框只是兜底（令牌过期、或从别的设备手输）。
 */
export function LoginForm({
  next,
  gateOff,
  autoToken,
}: {
  next: string;
  gateOff: boolean;
  autoToken?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(Boolean(autoToken) && !gateOff);

  // 扫码进来：不用等人点，挂载即换令牌
  useEffect(() => {
    if (!auto || !autoToken) return;

    let alive = true;
    setBusy(true);

    fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: autoToken, next }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          next?: string;
        };
        if (!alive) return;
        if (!res.ok || !data.ok) {
          // 令牌过期就退回手动输入，别把用户卡在空白页
          setAuto(false);
          setBusy(false);
          setError(data.error ?? "二维码已失效，手动输入口令");
          return;
        }
        router.replace(data.next ?? "/");
        router.refresh();
      })
      .catch(() => {
        if (!alive) return;
        setAuto(false);
        setBusy(false);
        setError("连不上服务器，检查网络后重试");
      });

    return () => {
      alive = false;
    };
  }, [auto, autoToken, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        next?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "登录失败，请重试");
        setBusy(false);
        return;
      }

      // 用 replace 而不是 push：登录页不该留在返回栈里
      router.replace(data.next ?? "/");
      router.refresh();
    } catch {
      setError("连不上服务器，检查网络后重试");
      setBusy(false);
    }
  }

  if (gateOff) {
    return (
      <div className="text-center text-sm text-slate-500">
        当前没有设置访问口令，无需登录。
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="ml-1 text-brand-600 underline underline-offset-2"
        >
          进入首页
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="mb-5 flex flex-col items-center gap-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <LockIcon className="h-6 w-6" />
        </span>
        <h1 className="text-base font-medium text-slate-900">需要访问口令</h1>
        <p className="text-center text-xs leading-relaxed text-slate-500">
          这是一台私人笔记服务器
          <br />
          输入口令后才能查看录音
        </p>
      </div>

      <label htmlFor="access-password" className="sr-only">
        访问口令
      </label>
      <input
        id="access-password"
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (error) setError("");
        }}
        placeholder="访问口令"
        autoComplete="current-password"
        autoFocus
        enterKeyHint="go"
        className="mb-3 w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
      />

      {error ? (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy || password.length === 0} className="w-full py-3">
        {busy ? "验证中…" : "进入"}
      </Button>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        记住这台设备，地址不变时 30 天内不用再输
      </p>
    </form>
  );
}
