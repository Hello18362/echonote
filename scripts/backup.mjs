#!/usr/bin/env node
/**
 * 本地备份：把数据库和音频复制到 backups/<时间戳>/，默认只保留最近 7 份。
 *
 * 用法：
 *   npm run backup
 *   node scripts/backup.mjs --keep 14                     # 保留 14 份
 *   node scripts/backup.mjs --no-audio                    # 只备份数据库
 *   node scripts/backup.mjs --out "D:\\我的空间\\EchoNote备份"  # 备份到别的盘
 *
 * 建议用 Windows 任务计划 / macOS launchd / cron 每天跑一次，见使用文档。
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  statfsSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);

function argValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function strValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const KEEP = argValue("--keep", 7);
const WITH_AUDIO = !argv.includes("--no-audio");
/** 备份根目录；相对路径按项目根解析，允许指到别的盘 */
const OUT_ROOT = path.resolve(ROOT, strValue("--out", "backups"));

/** 指定日志文件时自己写，避免 shell 重定向把中文写成乱码 */
const LOG_FILE = strValue("--log", "") ? path.resolve(ROOT, strValue("--log", "")) : "";
const LOG_MAX = 256 * 1024;

function appendLog(text) {
  if (!LOG_FILE) return;
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // 超过上限就只留末尾一段，别让日志无限长
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX) {
      const tail = readFileSync(LOG_FILE, "utf8").slice(-64 * 1024);
      writeFileSync(LOG_FILE, tail, "utf8");
    } else if (!existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, "", "utf8");
    }
    appendFileSync(LOG_FILE, text + "\n", "utf8");
  } catch {
    // 日志写不进去不能影响备份本身
  }
}

function say(line) {
  console.log(line);
  appendLog(line);
}

function readEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** DATABASE_URL=file:./dev.db 是相对 prisma/ 的路径 */
function resolveDbPath() {
  const env = { ...readEnv(), ...process.env };
  const url = env.DATABASE_URL || "file:./dev.db";
  const rel = url.replace(/^file:/, "");
  const candidates = [
    path.resolve(ROOT, "prisma", rel),
    path.resolve(ROOT, rel),
    path.resolve(ROOT, "prisma", "dev.db"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
    } catch {
      // 单个文件读不到就跳过
    }
  }
  return total;
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 备份目录名固定是 20261110-030000 这种，清理时只认这种，避免误删目标目录里的别的东西 */
const STAMP_RE = /^\d{8}-\d{6}$/;

/** 目标盘剩余空间不够就提前退出，比拷到一半写满更安全 */
function ensureSpace(dir, needBytes) {
  try {
    const st = statfsSync(dir);
    const free = Number(st.bavail) * Number(st.bsize);
    if (needBytes > 0 && free < needBytes * 1.15) {
      say(`✗ 目标盘空间不足：需要约 ${fmt(needBytes)}，可用 ${fmt(free)}。已中止，未改动任何文件。`);
      process.exit(1);
    }
  } catch {
    // 拿不到磁盘信息（老旧 Node 或不支持的文件系统）就不拦，继续拷
  }
}

function main() {
  say(`—— ${new Date().toLocaleString("zh-CN")} 开始备份 ——`);
  const db = resolveDbPath();
  if (!db) {
    say("✗ 没找到数据库文件。请先运行 npx prisma db push 初始化。");
    process.exit(1);
  }

  const audioSrc = path.join(ROOT, "data", "audio");
  const audioBytes = WITH_AUDIO && existsSync(audioSrc) ? dirSize(audioSrc) : 0;

  mkdirSync(OUT_ROOT, { recursive: true });
  ensureSpace(OUT_ROOT, audioBytes + statSync(db).size);

  const target = path.join(OUT_ROOT, stamp());
  mkdirSync(target, { recursive: true });

  const dbDest = path.join(target, path.basename(db));
  cpSync(db, dbDest);

  // 万一数据库切到了 WAL 模式，最近写入还在 -wal 里，一起带上才不丢数据
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${db}${suffix}`;
    if (existsSync(side)) {
      try {
        cpSync(side, `${dbDest}${suffix}`);
      } catch {
        say(`提示：${path.basename(side)} 拷贝失败，这份备份可能少了最近的写入`);
      }
    }
  }

  let audioInfo = "已跳过";
  if (WITH_AUDIO) {
    if (existsSync(audioSrc)) {
      cpSync(audioSrc, path.join(target, "audio"), { recursive: true });
      audioInfo = fmt(dirSize(path.join(target, "audio")));
    } else {
      audioInfo = "暂无音频";
    }
  }

  // 顺带存一份当前代码版本，方便知道备份对应哪一版
  const pkgFile = path.join(ROOT, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    cpSync(pkgFile, path.join(target, "package.json"));
    say(`备份版本：${pkg.name ?? "echonote"} ${pkg.version ?? ""}`.trim());
  }

  say(`数据库：${dbDest}（${fmt(statSync(dbDest).size)}）`);
  say(`音频：${audioInfo}`);
  say(`输出目录：${target}`);

  // 清理旧备份，保留最近 KEEP 份（按目录名排序即时间排序）
  const dirs = readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && STAMP_RE.test(d.name))
    .map((d) => d.name)
    .sort();

  const stale = dirs.slice(0, Math.max(0, dirs.length - KEEP));
  for (const name of stale) {
    rmSync(path.join(OUT_ROOT, name), { recursive: true, force: true });
    say(`清理旧备份：${name}`);
  }

  say(`完成。当前保留 ${Math.min(dirs.length, KEEP)} 份备份。`);
}

main();
