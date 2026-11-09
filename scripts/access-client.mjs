/**
 * 自检脚本的"进门"工具。
 *
 * 服务配了 ACCESS_PASSWORD 之后，所有接口都会返 401，smoke / ui-check 会被挡在门外。
 * 这里统一处理：读 .env 里的口令 → 换一张 cookie → 注入到后续请求里。
 * 没配口令时一切照旧，返回 null，不产生任何额外请求。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 从 .env 读 ACCESS_PASSWORD；没 .env 或没配就读 process.env */
export function accessPassword() {
  let fromEnv = "";
  try {
    const text = readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = text.match(/^\s*ACCESS_PASSWORD\s*=\s*"?([^"\r\n]*)"?\s*$/m);
    if (m) fromEnv = m[1].trim();
  } catch {
    // 没有 .env 就用进程环境
  }
  return fromEnv || (process.env.ACCESS_PASSWORD ?? "").trim();
}

/**
 * 登录并返回可直接塞进 Cookie 头的字符串；未启用门禁时返回 null。
 * 登录失败直接抛错——静默失败会让人以为是接口坏了。
 */
export async function loginCookie(base) {
  const password = accessPassword();
  if (!password) return null;

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`自检登录失败（${res.status}）：${body.slice(0, 120)}`);
  }

  // Node 18 的 Headers 没有 getSetCookie，只能取合并后的字符串
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("自检登录成功但没拿到 cookie");

  return raw
    .split(/,(?=\s*[a-zA-Z0-9_-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/** 给全局 fetch 套一层：只对本站请求补 cookie，外部地址不动 */
export function installAuthFetch(base, cookie) {
  if (!cookie) return;
  const raw = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith(base)) return raw(input, init);
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    return raw(input, { ...init, headers });
  };
}
