#!/usr/bin/env node
/**
 * 把「手机能打开的那个地址」画成一张二维码图片，拿手机对着屏幕扫。
 *
 * 出的是局域网地址（https://<本机IP>:3443）：手机连同一个 Wi-Fi 时直接打开网站。
 * 终端里那版字符二维码在屏幕上很难扫动，这张 PNG 是给人对着扫的。
 *
 * 地址里带当天免密令牌，换网络导致 IP 变了，重新扫一次就行，不用手打口令。
 *
 * 用法：
 *   node scripts/show-qr.mjs        → shots/phone-qr.png
 *   npm run qr
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { lanAddresses } from "./lan-info.mjs";
import { loginTokenFor, withToken } from "./qr-token.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.HTTPS_PORT ?? 3443);

function lanUrl() {
  const list = lanAddresses();
  return list.length > 0 ? `https://${list[0].address}:${PORT}` : null;
}

async function main() {
  const url = lanUrl();
  if (!url) {
    console.error("没检测到局域网地址，先把电脑的网络连上。");
    process.exit(1);
  }

  const scanUrl = withToken(url, loginTokenFor(root));

  // 探活走 http 3000：本机 https 是自签证书，fetch 会因证书校验失败而报错，
  // 那不代表服务没起来。
  let alive = false;
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/login`, {
      signal: AbortSignal.timeout(5000),
    });
    alive = res.status > 0;
  } catch {
    alive = false;
  }

  const dir = path.join(root, "shots");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "phone-qr.png");

  await QRCode.toFile(file, scanUrl, {
    width: 760,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  console.log(`地址  ${url}`);
  console.log(`图片  ${file}`);
  console.log(`状态  ${alive ? "服务在跑" : "服务没起来（先启动 EchoNote）"}`);
  console.log("");
  console.log("手机连同一个 Wi-Fi，用自带相机对着图片停两秒；扫了直接进，不用输口令。");
  console.log("连不上也不用折腾：把录音文件放进「录音收件箱」文件夹，一样会自动转写。");
}

main().catch((err) => {
  console.error("生成失败：", err.message);
  process.exit(1);
});
