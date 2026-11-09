#!/usr/bin/env node
/**
 * EchoNote 启动器（生产模式）
 *
 * 同时监听两个端口：
 *   - HTTP  3000  给电脑自己用
 *   - HTTPS 3443  给手机用
 *
 * 为什么手机必须走 HTTPS：浏览器的麦克风只在「安全上下文」下可用，
 * 也就是 https:// 或 localhost。手机用 http://192.168.x.x:3000 打开时，
 * 页面能看，但一点录音就被浏览器拒绝，这条规则绕不过去。
 *
 * 证书是自签的（调用本机 openssl 生成），手机第一次打开会提示不安全，
 * 点「继续访问」即可。为了让这个提示尽量少出现，证书里会把当前所有
 * 局域网 IP 都写进 SAN；换了网络（IP 变了）会自动重新生成。
 */

import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lanAddresses, reportPhoneUrl } from "./lan-info.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 从任何目录启动都要落在项目根上：开机自启、计划任务、直接从 C:\ 调用时
// cwd 往往不是项目目录，而 data/、certificates/ 这些相对路径会因此指错地方。
try {
  process.chdir(root);
} catch {
  // 万一没有权限就维持原样，不能因此起不来
}

const CERT_DIR = path.join(root, "certificates");
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);

/* ---------------------------------------------------------------- 证书 */

function findOpenssl() {
  const candidates = [
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
    "/usr/bin/openssl",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function ensureCert(ips) {
  mkdirSync(CERT_DIR, { recursive: true });
  const keyFile = path.join(CERT_DIR, "key.pem");
  const certFile = path.join(CERT_DIR, "cert.pem");
  const metaFile = path.join(CERT_DIR, "meta.json");

  const signature = ["127.0.0.1", ...ips].join(",");
  if (existsSync(keyFile) && existsSync(certFile) && existsSync(metaFile)) {
    try {
      if (JSON.parse(readFileSync(metaFile, "utf8")).ips === signature) {
        return { keyFile, certFile };
      }
    } catch {
      // meta 损坏就重新生成
    }
  }

  const openssl = findOpenssl();
  if (!openssl) {
    throw new Error(
      "找不到 openssl。装了 Git for Windows 的话它自带（C:\\Program Files\\Git\\usr\\bin\\openssl.exe）。",
    );
  }

  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  execFileSync(
    openssl,
    [
      "req", "-x509",
      "-newkey", "rsa:2048",
      "-sha256",
      "-days", "825",
      "-nodes",
      "-keyout", keyFile,
      "-out", certFile,
      "-subj", "/CN=EchoNote",
      "-addext", `subjectAltName=${san}`,
    ],
    { stdio: "pipe" },
  );

  writeFileSync(metaFile, JSON.stringify({ ips: signature, createdAt: new Date().toISOString() }, null, 2));
  return { keyFile, certFile };
}

/* ------------------------------------------------------------ 启动服务 */

async function main() {
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.error("[X] 缺少构建产物 .next，请先运行 npm run build");
    process.exit(1);
  }

  const ips = [...new Set(lanAddresses().map((a) => a.address))];

  // 证书生成失败不致命：电脑端 http 照样能用，只是手机录音会不可用
  let cert = null;
  try {
    cert = ensureCert(ips);
  } catch (err) {
    console.warn("[!] 无法生成 HTTPS 证书，手机访问不可用：" + err.message);
    console.warn("    电脑端不受影响，继续用 http://127.0.0.1:" + HTTP_PORT);
  }

  process.env.NODE_ENV = "production";
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: root });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createHttpServer((req, res) => handle(req, res));

  /**
   * 大文件上传要时间：Node 18+ 默认 requestTimeout 是 5 分钟。
   * 200MB 在手机弱网下很容易超过，超时后连接会被直接掐断，
   * 页面上的表现就是「传着传着网站打不开了」。本机自用不需要这层保护。
   */
  const tune = (server) => {
    server.requestTimeout = 0;
    server.headersTimeout = 65_000;
    server.keepAliveTimeout = 65_000;
  };
  tune(httpServer);

  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[X] 端口 ${HTTP_PORT} 已被占用，可能已经有一份 EchoNote 在跑。`);
    } else {
      console.error("[X] HTTP 服务启动失败：", err);
    }
    process.exit(1);
  });

  httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log("");
    console.log("  EchoNote 已就绪");
    console.log("  ────────────────────────────────────────");
    console.log(`  电脑  http://127.0.0.1:${HTTP_PORT}`);
  });

  const servers = [httpServer];

  if (cert) {
    const httpsServer = createHttpsServer(
      { key: readFileSync(cert.keyFile), cert: readFileSync(cert.certFile) },
      (req, res) => {
        // Next 生成绝对地址 / 重定向时需要知道真实协议
        req.headers["x-forwarded-proto"] = "https";
        handle(req, res);
      },
    );
    tune(httpsServer);
    // 手机端不是必需的：端口被占/权限不足时只警告，电脑端继续用
    httpsServer.on("error", (err) => {
      console.warn(`[!] HTTPS 端口 ${HTTPS_PORT} 监听失败（电脑端不受影响）：${err.message}`);
    });
    servers.push(httpsServer);

    httpsServer.listen(HTTPS_PORT, "0.0.0.0", async () => {
      await reportPhoneUrl(HTTPS_PORT);
      console.log("");
      console.log("  停止服务：Stop-ScheduledTask -TaskName EchoNote，或结束 node 进程。");
      console.log("");
    });
  } else {
    console.log("");
    console.log("  停止服务：Stop-ScheduledTask -TaskName EchoNote，或结束 node 进程。");
    console.log("");
  }

  const shutdown = () => {
    console.log("\n正在停止…");
    for (const s of servers) s.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[X] 启动失败：", err);
  process.exit(1);
});

/**
 * 进程级兜底。
 * - 未处理的 Promise 拒绝：多半是某个请求里的异步错误，记一笔，服务继续。
 * - 未捕获异常：进程状态已经不可信，打印后退出，交给 boot.mjs 重启。
 *   没有这两行的话，一个漏 catch 的异步错误就能让整个网站悄无声息地消失。
 */
process.on("unhandledRejection", (reason) => {
  console.error("[server] 未处理的 Promise 拒绝（服务继续运行）", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] 未捕获异常，退出以便自动重启", err);
  process.exit(1);
});
