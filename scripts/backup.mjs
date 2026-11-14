#!/usr/bin/env node
/**
 * 本地备份：把数据库和音频复制到 backups/<时间戳>/，默认只保留最近 7 份。
 *
 * 用法：
 *   npm run backup
 *   node scripts/backup.mjs --keep 14                     # 保留 14 份
 *   node scripts/backup.mjs --no-audio                    # 只备份数据库
 *   node scripts/backup.mjs --out "D:\\EchoNote备份"      # 备份到别的盘
 *
 * 建议用 Windows 任务计划 / macOS launchd / cron 每天跑一次，见使用文档。
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  statfsSync,
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

const KEEP = argValue("--keep", 14);
const WITH_AUDIO = !argv.includes("--no-audio");
/**
 * 备份根目录优先级：--out 参数 > .env 的 ECHONOTE_BACKUP_DIR > 项目内 backups/。
 * 这样启动器补跑时不传参数也能找到同一个位置。
 */
const OUT_ROOT = path.resolve(
  ROOT,
  strValue("--out", readEnv().ECHONOTE_BACKUP_DIR || "backups"),
);

/** 补跑模式：只在上次备份超过 CATCH_UP_HOURS 小时时才真的备份 */
const CATCH_UP = argv.includes("--catch-up");
const CATCH_UP_HOURS = Number(process.env.ECHONOTE_CATCHUP_HOURS) > 0
  ? Number(process.env.ECHONOTE_CATCHUP_HOURS)
  : 20;

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


function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 备份目录名固定是 20261110-030000 这种，清理时只认这种，避免误删目标目录里的别的东西 */
const STAMP_RE = /^\d{8}-\d{6}$/;

/** 把 20261110-030000 解析成时间戳，判断「上次备份多久以前」 */
function stampToTime(name) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/** 已有的最新一份备份时间；没有就返回 0 */
function latestBackupTime(outRoot) {
  if (!existsSync(outRoot)) return 0;
  let latest = 0;
  for (const entry of readdirSync(outRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !STAMP_RE.test(entry.name)) continue;
    latest = Math.max(latest, stampToTime(entry.name));
  }
  return latest;
}

/**
 * 收集历史备份里已有音频：文件名 -> 路径/大小。
 * 音频用 UUID 命名、写入后不再改动，所以完全可以跨备份共用同一份物理数据。
 */
function indexExistingAudio(outRoot) {
  const index = new Map();
  if (!existsSync(outRoot)) return index;

  const dirs = readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && STAMP_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const name of dirs) {
    const dir = path.join(outRoot, name, "audio");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || index.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      try {
        index.set(entry.name, { full, size: statSync(full).size });
      } catch {
        // 读不到就当作没有，走复制
      }
    }
  }
  return index;
}

/**
 * 拷贝音频目录，但已有同内容的文件用硬链接复用，不重复占空间。
 * 硬链接失败（跨卷、文件系统不支持）时自动退回真实复制，不影响备份完整性。
 */
function copyAudioPooled(srcDir, destDir, index) {
  mkdirSync(destDir, { recursive: true });
  let copied = 0;
  let linked = 0;
  let bytes = 0;

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    let size = 0;
    try {
      size = statSync(from).size;
      bytes += size;
    } catch {
      continue;
    }

    const hit = index.get(entry.name);
    if (hit && hit.size === size) {
      try {
        linkSync(hit.full, to);
        linked += 1;
        continue;
      } catch {
        // 退回复制
      }
    }
    try {
      cpSync(from, to);
      copied += 1;
    } catch (err) {
      say(`提示：${entry.name} 拷贝失败（${err.message}）`);
    }
  }
  return { copied, linked, bytes };
}

/** 目标盘剩余空间不够就提前退出，比拷到一半写满更安全 */
function freeBytes(dir) {
  try {
    const st = statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return 0;
  }
}

function ensureSpace(dir, needBytes) {
  try {
    const free = freeBytes(dir);
    if (needBytes > 0 && free > 0 && free < needBytes * 1.15) {
      say(`✗ 目标盘空间不足：需要约 ${fmt(needBytes)}，可用 ${fmt(free)}。已中止，未改动任何文件。`);
      process.exit(1);
    }
  } catch {
    // 拿不到磁盘信息（老旧 Node 或不支持的文件系统）就不拦，继续拷
  }
}

function main() {
  // 补跑模式：开机时由启动器调用，最近备份还新鲜就直接退出，不做无谓的拷贝
  if (CATCH_UP) {
    const latest = latestBackupTime(OUT_ROOT);
    if (latest) {
      const hours = (Date.now() - latest) / 3600000;
      if (hours < CATCH_UP_HOURS) {
        say(`最近一份备份在 ${hours.toFixed(1)} 小时前，还新鲜，跳过。`);
        return;
      }
      say(`最近一份备份在 ${hours.toFixed(1)} 小时前（超过 ${CATCH_UP_HOURS} 小时），补跑一次。`);
    } else {
      say("还没有任何备份，立即补跑一次。");
    }
  }

  say(`—— ${new Date().toLocaleString("zh-CN")} 开始备份 ——`);
  const db = resolveDbPath();
  if (!db) {
    say("✗ 没找到数据库文件。请先运行 npx prisma db push 初始化。");
    process.exit(1);
  }

  const audioSrc = path.join(ROOT, "data", "audio");
  mkdirSync(OUT_ROOT, { recursive: true });

  // 先看历史备份里哪些音频能直接复用，再算真实需要多少空间，避免误判空间不足
  const audioIndex =
    WITH_AUDIO && existsSync(audioSrc) ? indexExistingAudio(OUT_ROOT) : new Map();
  let needBytes = statSync(db).size;
  if (WITH_AUDIO && existsSync(audioSrc)) {
    for (const entry of readdirSync(audioSrc, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        const size = statSync(path.join(audioSrc, entry.name)).size;
        const hit = audioIndex.get(entry.name);
        if (!(hit && hit.size === size)) needBytes += size;
      } catch {
        // 读不到就不计入
      }
    }
  }
  ensureSpace(OUT_ROOT, needBytes);
  const freeBefore = freeBytes(OUT_ROOT);

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
      const r = copyAudioPooled(audioSrc, path.join(target, "audio"), audioIndex);
      audioInfo = `${fmt(r.bytes)}（复用 ${r.linked} 个，新复制 ${r.copied} 个）`;
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

  const freeAfter = freeBytes(OUT_ROOT);
  if (freeBefore > 0 && freeAfter > 0) {
    say(`本份实际占用：约 ${fmt(Math.max(0, freeBefore - freeAfter))}`);
  }

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

  say(`完成。当前保留 ${Math.min(dirs.length, KEEP)} 份备份（未变的音频在份与份之间共用同一份物理数据，份数多不多占空间）。`);
}

main();
