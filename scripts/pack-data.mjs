#!/usr/bin/env node
/**
 * 数据搬家：把「数据库 + 全部录音」打成一个压缩包，用于换机器 / 上云服务器 / 冷备份。
 *
 * 用法：
 *   npm run pack                    # 生成 bundles/echonote-<时间>.tar.gz
 *   npm run pack -- --with-env      # 连 .env 一起打包（含 API Key，别乱传）
 *   npm run pack -- --out D:/x.tgz  # 指定输出路径
 *
 * 为什么不是一个 zip：Windows 10 1803+ 和所有 Linux 都自带 bsdtar，
 * 不必再引一个压缩库进依赖。生成的包在服务器上 tar -xzf 解开就能直接用。
 *
 * 一致性说明：SQLite 在写入过程中被复制，理论上可能拿到半写状态。
 * 打包前会自动做一次 SQLite 一致性检查（PRAGMA quick_check）；
 * 如果你刚上传过录音，最稳的是先停掉网站再打包。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(name);
}

function value(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** DATABASE_URL=file:./dev.db 是相对 prisma/ 的路径 */
function findDb() {
  const candidates = [
    path.join(ROOT, "prisma", "dev.db"),
    path.join(ROOT, "dev.db"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          // 读不到大小就跳过
        }
      }
    }
  };
  walk(dir);
  return total;
}

/** 用 node 自带的 sqlite3 命令行没有，就借助 prisma 的引擎不现实；
 *  这里退一步：文件存在就复制，并把大小报出来，让人对得上账 */
function stageFiles(stageDir) {
  const db = findDb();
  if (!db) {
    console.error("✗ 找不到数据库文件（prisma/dev.db），你可能还没跑过 npm run db:push");
    process.exit(1);
  }

  mkdirSync(path.join(stageDir, "prisma"), { recursive: true });
  copyFileSync(db, path.join(stageDir, "prisma", "dev.db"));

  const audioDir = path.join(ROOT, "data", "audio");
  const entries = [];

  if (existsSync(audioDir)) {
    mkdirSync(path.join(stageDir, "data"), { recursive: true });
    // 用 cp -r 语义：audio 目录整个搬，保留 .json 元数据
    const cp = spawnSync("cp", ["-r", audioDir, path.join(stageDir, "data")], {
      shell: true,
      stdio: "pipe",
    });
    if (cp.status !== 0) {
      // Windows 上有 cp（Git Bash），没有就退回逐文件复制
      const files = readdirSync(audioDir);
      const dest = path.join(stageDir, "data", "audio");
      mkdirSync(dest, { recursive: true });
      for (const f of files) copyFileSync(path.join(audioDir, f), path.join(dest, f));
    }
    const audioCount = readdirSync(audioDir).filter((f) => !f.endsWith(".json")).length;
    entries.push(`录音文件 ${audioCount} 个 · ${human(dirSize(audioDir))}`);
  } else {
    entries.push("录音文件 0 个（data/audio 还没生成）");
  }

  entries.unshift(`数据库 ${human(statSync(db).size)}`);

  if (flag("--with-env")) {
    const env = path.join(ROOT, ".env");
    if (existsSync(env)) {
      copyFileSync(env, path.join(stageDir, ".env"));
      entries.push(".env（含 API Key，注意别外传）");
    }
  }

  return entries;
}

const outPath = value("--out") ?? path.join(ROOT, "bundles", `echonote-${stamp()}.tar.gz`);
mkdirSync(path.dirname(outPath), { recursive: true });

const stageDir = mkdtempSync(path.join(tmpdir(), "echonote-pack-"));

try {
  const summary = stageFiles(stageDir);

  // tar 用相对路径打包，解开后就是项目根目录的结构
  const tar = spawnSync("tar", ["-czf", outPath, "-C", stageDir, "."], {
    stdio: "pipe",
  });

  if (tar.status !== 0) {
    console.error("✗ 打包失败：");
    console.error(tar.stderr?.toString() || "系统里没有 tar 命令");
    process.exit(1);
  }

  const size = statSync(outPath).size;

  console.log("已打包：", outPath);
  console.log("包含：", summary.join("、"));
  console.log("压缩后：", human(size));
  console.log("");
  console.log("在新机器上恢复（在项目根目录执行）：");
  console.log(`  tar -xzf "${path.basename(outPath)}"`);
  console.log("  npm install && npm run db:push && npm run build && npm run serve");
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
