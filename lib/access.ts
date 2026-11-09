/**
 * 公网访问门禁：一个口令换一张签名 cookie。
 *
 * 设计取舍：
 * - 不是多用户账号系统。只有一把锁，锁后面就是你自己。要走公网，这是最低限度。
 * - 没配 ACCESS_PASSWORD 时完全放行，所以本地开发、局域网调试的行为跟以前一模一样。
 * - 签名用 Web Crypto（HMAC-SHA256），middleware 跑在 Edge Runtime 也能用，不依赖 node:crypto。
 * - cookie 是无状态令牌，不落库。改口令 = 所有旧 cookie 立即失效，这是想要的效果。
 */

export const ACCESS_COOKIE = "echonote_access";

/** cookie 有效期 30 天；剩余不足 25 天时在响应里顺手续期，常用设备就不会突然被踢 */
export const ACCESS_MAX_AGE_S = 30 * 24 * 60 * 60;
const RENEW_BEFORE_MS = 25 * 24 * 60 * 60 * 1000;

export function accessPassword(): string {
  return (process.env.ACCESS_PASSWORD ?? "").trim();
}

/** 没设口令 = 不启用。本地和局域网用法不受任何影响 */
export function accessEnabled(): boolean {
  return accessPassword().length > 0;
}

/**
 * 交给 Web Crypto 的必须是 ArrayBuffer。
 * TextEncoder.encode() 每次返回新分配的、大小正好的 Uint8Array，所以直接取 buffer 是安全的；
 * 这里必须显式转一下，否则 TS 5.7+ 的 BufferSource 定义不认 Uint8Array<ArrayBufferLike>。
 */
function enc(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toHex(buf: ArrayBuffer): string {
  let out = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  // 口令本身就是密钥材料。能伪造签名 ≈ 能猜出口令，难度一致，不必再加一层慢哈希
  // （middleware 每个请求都跑，PBKDF2 十万次会把首屏拖慢几十毫秒）
  return crypto.subtle.importKey(
    "raw",
    enc(`echonote-access-v1:${accessPassword()}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** 令牌格式：<过期时间毫秒>.<hmac hex> */
export async function signToken(expiresAt: number): Promise<string> {
  const payload = String(expiresAt);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc(payload));
  return `${payload}.${toHex(sig)}`;
}

export type TokenCheck =
  | { ok: true; expiresAt: number; needsRenew: boolean }
  | { ok: false };

export async function verifyToken(value: string | undefined): Promise<TokenCheck> {
  if (!value) return { ok: false };

  const dot = value.lastIndexOf(".");
  if (dot <= 0) return { ok: false };

  const payload = value.slice(0, dot);
  const given = value.slice(dot + 1);
  if (!/^\d+$/.test(payload) || given.length !== 64) return { ok: false };

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return { ok: false };

  let expected: string;
  try {
    const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc(payload));
    expected = toHex(sig);
  } catch {
    return { ok: false };
  }

  // 逐位比较，不因首个不同就返回。时间攻击在网络上不现实，但成本几乎为零
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false };

  const now = Date.now();
  if (expiresAt <= now) return { ok: false };

  return { ok: true, expiresAt, needsRenew: expiresAt - now < RENEW_BEFORE_MS };
}

/** 口令比对同样走常量时间，避免逐字符试错 */
export function passwordMatches(input: string): boolean {
  const expected = accessPassword();
  const a = bytes(input);
  const b = bytes(expected);
  // 长度不同也要把循环跑完，用较长的那个当上限
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/* --------------------------------------------------------------- 扫码免密 */

/**
 * 公网地址每次重启都可能变，域名一变 cookie 就作废，口令得重输。
 * 这个令牌就是为了绕开这件事：启动器把令牌拼进二维码，手机一扫直接进。
 *
 * 为什么不用「把口令直接拼进链接」：隧道是第三方（serveo）在中间转发，
 * 它能看到完整 URL，把长期口令写进去等于把锁的钥匙交给中间人。
 * 这里用口令做 HMAC 密钥派生出一天一换的短期令牌，泄露了也只到当天为止。
 */
export const QR_TOKEN_LEN = 20;

/** 日期键按本机时区算。服务端和启动器在同一台机器上，不会有时区分歧 */
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function qrKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc(`echonote-qr-v1:${accessPassword()}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** key 是日期字符串。同一台机器上任何一天算出来都一样 */
export async function qrTokenFor(key: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await qrKey(), enc(`qr:${key}`));
  return toHex(sig).slice(0, QR_TOKEN_LEN);
}

/** 今天和昨天都认：晚上扫码、跨过零点再打开，不该突然失效 */
export async function verifyQrToken(token: string): Promise<boolean> {
  if (!token || token.length !== QR_TOKEN_LEN) return false;

  const now = new Date();
  const keys = [dateKey(now), dateKey(new Date(now.getTime() - 86_400_000))];

  for (const k of keys) {
    const expected = await qrTokenFor(k);
    let d = 0;
    // 长度已固定，逐位比完，不因首个不同就返回
    for (let i = 0; i < QR_TOKEN_LEN; i++) d |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    if (d === 0) return true;
  }
  return false;
}

/** 登录后要跳回的地址，只允许站内相对路径，挡掉 //evil.com 这种开放重定向 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}
