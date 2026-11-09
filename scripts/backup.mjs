#!/usr/bin/env node
/**
 * 本地备份：把数据库和音频复制到 backups/<时间戳>/，默认只保留最近 7 份。
 *
 * 用法：
 *   npm run backup
 *   node scripts/backup.mjs --keep 14     # 保留 14 份
 *   node scripts/backup.mjs --no-audio    # 只备份数据库
 *
 * 建议用 Windows 任务计划 / macOS launchd / cron 每天跑一次，见使用文档。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);

function argValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

const KEEP = argValue("--keep", 7);
const WITH_AUDIO = !argv.includes("--no-audio");

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

function main() {
  const db = resolveDbPath();
  if (!db) {
    console.error("没找到数据库文件。请先运行 npx prisma db push 初始化。");
    process.exit(1);
  }

  const target = path.join(ROOT, "backups", stamp());
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
        console.warn(`提示：${path.basename(side)} 拷贝失败，这份备份可能少了最近的写入`);
      }
    }
  }

  let audioInfo = "已跳过";
  if (WITH_AUDIO) {
    const audioSrc = path.join(ROOT, "data", "audio");
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
    console.log(`备份版本：${pkg.name ?? "echonote"} ${pkg.version ?? ""}`.trim());
  }

  console.log(`数据库：${path.relative(ROOT, dbDest)}（${fmt(statSync(dbDest).size)}）`);
  console.log(`音频：${audioInfo}`);
  console.log(`输出目录：${path.relative(ROOT, target)}`);

  // 清理旧备份，保留最近 KEEP 份（按目录名排序即时间排序）
  const backupRoot = path.join(ROOT, "backups");
  const dirs = readdirSync(backupRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const stale = dirs.slice(0, Math.max(0, dirs.length - KEEP));
  for (const name of stale) {
    rmSync(path.join(backupRoot, name), { recursive: true, force: true });
    console.log(`清理旧备份：${name}`);
  }

  console.log(`完成。当前保留 ${Math.min(dirs.length, KEEP)} 份备份。`);
}

main();
