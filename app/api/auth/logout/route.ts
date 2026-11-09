import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 退出登录：清掉门禁 cookie。只影响当前浏览器 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
