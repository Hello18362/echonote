/**
 * 扫码免密令牌：脚本侧实现，必须和 lib/access.ts 的 qrTokenFor 算出同一个值。
 *
 * 为什么要它：局域网 IP 会变（换 Wi-Fi、路由器重新分配），IP 一变 cookie 就失效，
 * 手机上又得手打一遍口令。把令牌拼进二维码，地址换了重新扫一下就进去了。
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export function qrToken(password, dateKey) {
  return createHmac("sha256", `echonote-qr-v1:${password}`)
    .update(`qr:${dateKey}`)
    .digest("hex")
    .slice(0, 20);
}

export function localDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 没设访问口令就没有令牌——门不存在，也用不着钥匙 */
export function loginTokenFor(root) {
  const password = (readEnvFile(path.join(root, ".env")).ACCESS_PASSWORD ?? "").trim();
  if (!password) return null;
  return qrToken(password, localDateKey());
}

/** 给地址加上扫码令牌 */
export function withToken(url, token) {
  return token ? `${url}/login?k=${token}` : url;
}
