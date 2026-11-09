#!/usr/bin/env node
/**
 * EchoNote 启动器：拉起网站进程，并盯着它别悄悄死掉。
 *
 * 为什么不再默认拉公网隧道：免费隧道地址每次都变、偶尔假死回 502，为了手机
 * 在户外能用，代价是每次都要重新出码。日常路径是「手机录音 → 传到电脑 →
 * 收件箱自动转写」，这条路上根本不需要公网。
 *
 * 为什么要在这里做「看守」：网站是进程内异步任务，进程一退出，页面就打不开。
 * 之前崩了只能等人发现。现在子进程非正常退出会按退避重启，连续多次失败才
 * 放弃并把退出码交给计划任务（计划任务里也配了失败重启，双保险）。
 *
 * 用法：
 *   node scripts/boot.mjs
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const PORT = Number(process.env.PORT ?? 3000);

/**
 * 同一份输出既进窗口也进 data/boot.log。
 * 计划任务会把 stdout 直接重定向到同一个文件，这时再写一遍就会每行两次 ——
 * 所以只在真终端里才额外落文件。
 */
const LOG_FILE = path.join(root, "data", "boot.log");
const LOG_MAX = 1024 * 1024;
const ECHO_TO_FILE = Boolean(process.stdout.isTTY);

try {
  mkdirSync(path.join(root, "data"), { recursive: true });
  // 超过 1MB 就清空重来，不做滚动归档——这是给人看的启动记录，不是审计日志
  if (statSync(LOG_FILE).size > LOG_MAX) truncateSync(LOG_FILE, 0);
} catch {
  // 没有文件或没权限就算了，日志不是必需品
}

function appendLog(text) {
  if (!ECHO_TO_FILE) return;
  try {
    appendFileSync(LOG_FILE, text);
  } catch {
    // 忽略
  }
}

function log(msg) {
  console.log(msg);
  appendLog(`${msg}\n`);
}

/** 最近重启时间戳，用来判断「是不是在疯狂崩溃」 */
const restarts = [];
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000;

let shuttingDown = false;
let child = null;

function startServer() {
  // 不能用 stdio: "inherit"：那样子进程直接写终端，日志文件里就只有自己打的字。
  const proc = spawn(node, [path.join(root, "scripts", "serve-https.mjs")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const forward = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    appendLog(text);
  };
  proc.stdout?.on("data", forward);
  proc.stderr?.on("data", forward);
  return proc;
}

/** 端口上有没有服务在应答。用来判断「已经有一份在跑」和「服务起来了」 */
async function probe() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/login`, {
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    if (shuttingDown) return false;
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("\n  正在停止…");
  try {
    child?.kill();
  } catch {
    // 已经退了
  }
  // 留一点时间让 Next 关掉监听端口，避免下一次启动撞 EADDRINUSE
  setTimeout(() => process.exit(code), 1500);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function scheduleRestart() {
  const now = Date.now();
  while (restarts.length > 0 && now - restarts[0] > RESTART_WINDOW_MS) restarts.shift();
  restarts.push(now);

  if (restarts.length > MAX_RESTARTS) {
    console.error(`  [X] 10 分钟内已重启 ${MAX_RESTARTS} 次，不再重试。`);
    console.error("      看 data/boot.log 里的报错，或用 npm run serve 前台排查。");
    stopAll(1);
    return;
  }

  // 1s、2s、4s…最多 8s。刚崩的进程往往端口还没释放，立刻重试只会连撞
  const delay = Math.min(8000, 1000 * 2 ** (restarts.length - 1));
  log(`  [!] ${delay / 1000} 秒后自动重启（第 ${restarts.length} 次）`);
  setTimeout(() => {
    if (shuttingDown) return;
    void launch();
  }, delay);
}

async function launch() {
  log("  EchoNote 启动中…（首次约 5 秒）");

  child = startServer();

  const ready = await waitForServer();
  if (!ready) {
    console.error("  [X] 服务 90 秒内没起来。看上面有没有报错。");
    // 让子进程先退，再决定要不要重试；否则可能留下一个半死进程占着端口
    try {
      child.kill();
    } catch {
      // 已经退了
    }
    scheduleRestart();
    return;
  }

  log("");
  log("  ────────────────────────────────────────");
  log(`  电脑  http://127.0.0.1:${PORT}`);
  log("  手机录音 → 把文件放进「录音收件箱」文件夹 → 自动转写。");
  log("  首页有一条蓝色入口，可以直接打开那个文件夹。");
  log("  ────────────────────────────────────────");
  log("");

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // 正常退出（code 0）说明是有人有意停的（比如设置了维护），不自动拉起；
    // 非 0 或被信号杀掉才按「意外退出」处理
    if (code === 0) {
      log("  服务进程已正常退出。");
      stopAll(0);
      return;
    }
    console.error(`  [X] 服务进程异常退出（code=${code ?? "null"} signal=${signal ?? "null"}）`);
    scheduleRestart();
  });
}

async function main() {
  // 开机自启 + 手动双击可能撞在一起。已经有实例在跑就安静退出，
  // 别去抢端口（抢占失败会弹一堆 EADDRINUSE，看着像坏了）
  if (await probe()) {
    log(`  服务已经在跑了（http://127.0.0.1:${PORT}），这次不重复启动。`);
    return;
  }

  await launch();
}

main().catch((err) => {
  console.error("  [X] 启动失败：", err);
  stopAll(1);
});
