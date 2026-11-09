import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_S,
  accessEnabled,
  signToken,
  verifyToken,
} from "@/lib/access";

/**
 * 公网门禁。只在设置了 ACCESS_PASSWORD 时生效，否则整段直接放行。
 *
 * 放行清单的原则：登录自己要用，静态资源拦了页面会白屏，
 * 分享链接本来就要给外部看（令牌在 URL 里，本身就是凭证）。
 */
const PUBLIC_PREFIXES = ["/login", "/api/auth", "/s/", "/_next/", "/icons/"];
const PUBLIC_EXACT = new Set([
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/robots.txt",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  // 没设口令 ⇒ 不启用门禁。本地开发、局域网访问完全不受影响
  if (!accessEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const check = await verifyToken(req.cookies.get(ACCESS_COOKIE)?.value);

  if (check.ok) {
    const res = NextResponse.next();
    // 快到期就顺手续一张，常用设备不会被突然踢下线
    if (check.needsRenew) {
      const token = await signToken(Date.now() + ACCESS_MAX_AGE_S * 1000);
      res.cookies.set(ACCESS_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_MAX_AGE_S,
      });
    }
    return res;
  }

  // 接口一律回 401 JSON，前端能识别；页面则跳登录页
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "需要先输入访问口令", needLogin: true },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const back = pathname + search;
  if (back && back !== "/") url.searchParams.set("next", back);
  return NextResponse.redirect(url);
}

export const config = {
  // 静态资源不进 middleware，省掉每个请求一次签名校验
  matcher: ["/((?!_next/static|_next/image).*)"],
};
