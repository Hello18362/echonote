import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_S,
  accessEnabled,
  passwordMatches,
  safeNext,
  signToken,
  verifyQrToken,
} from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 失败限流：同一 IP 连续错 5 次锁 60 秒。
 * 进程内 Map 够用 —— 这是给自己用的一把锁，不是对外服务，
 * 真正挡住暴力破解的是「口令本身要够长」。
 */
const FAIL_LIMIT = 5;
const LOCK_MS = 60_000;

type Bucket = { fails: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** 顺手清理过期桶，避免长期运行越攒越多 */
function sweep() {
  if (buckets.size < 500) return;
  const now = Date.now();
  // 用 forEach 而不是 for...of：tsconfig 没开 downlevelIteration
  buckets.forEach((b, ip) => {
    if (b.lockedUntil < now && b.fails === 0) buckets.delete(ip);
  });
}

export async function POST(req: NextRequest) {
  if (!accessEnabled()) {
    // 没配口令时不提供登录，直接告诉前端「无需登录」
    return NextResponse.json({ ok: true, next: "/", noGate: true });
  }

  sweep();
  const ip = clientIp(req);
  const bucket = buckets.get(ip) ?? { fails: 0, lockedUntil: 0 };
  const now = Date.now();

  if (bucket.lockedUntil > now) {
    const wait = Math.ceil((bucket.lockedUntil - now) / 1000);
    return NextResponse.json(
      { ok: false, error: `尝试次数过多，请 ${wait} 秒后再试` },
      { status: 429 },
    );
  }

  let password = "";
  let scanToken = "";
  let next = "/";
  try {
    const body = (await req.json()) as { password?: unknown; token?: unknown; next?: unknown };
    password = typeof body.password === "string" ? body.password : "";
    scanToken = typeof body.token === "string" ? body.token : "";
    next = safeNext(typeof body.next === "string" ? body.next : null);
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不对" }, { status: 400 });
  }

  // 扫码通道：启动器把当天令牌拼进二维码，扫完直接进，不用手打口令。
  // 走这条不记失败次数 —— 令牌错了说明链接过期，让人重扫比让他等 60 秒合理。
  if (scanToken) {
    if (!(await verifyQrToken(scanToken))) {
      return NextResponse.json(
        { ok: false, error: "这个二维码过期了，回电脑上看一眼新的" },
        { status: 401 },
      );
    }
    const cookie = await signToken(Date.now() + ACCESS_MAX_AGE_S * 1000);
    const qrRes = NextResponse.json({ ok: true, next });
    qrRes.cookies.set(ACCESS_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_MAX_AGE_S,
    });
    return qrRes;
  }

  if (!password || !passwordMatches(password)) {
    bucket.fails += 1;
    if (bucket.fails >= FAIL_LIMIT) {
      bucket.lockedUntil = now + LOCK_MS;
      bucket.fails = 0;
      buckets.set(ip, bucket);
      return NextResponse.json(
        { ok: false, error: "口令错误次数过多，请 60 秒后再试" },
        { status: 429 },
      );
    }
    buckets.set(ip, bucket);
    const left = FAIL_LIMIT - bucket.fails;
    return NextResponse.json(
      { ok: false, error: `口令不正确，还可以试 ${left} 次` },
      { status: 401 },
    );
  }

  buckets.delete(ip);

  const token = await signToken(now + ACCESS_MAX_AGE_S * 1000);
  const res = NextResponse.json({ ok: true, next });
  res.cookies.set(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE_S,
  });
  return res;
}
