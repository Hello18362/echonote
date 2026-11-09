/**
 * 测试脚本共用的「Mock 模式」开关。
 *
 * 为什么需要：smoke.mjs 上传的是随机字节的假音频，ui-check.mjs 用的是虚拟麦克风
 * 合成的音调，真实语音识别接口都得不到有意义的文本。而用户很可能已经在设置页
 * 配好了真实 Key，这时 pipeline 会真的去调外部服务——结果是断言必然失败，
 * 还白白消耗额度。
 *
 * 做法：测试期间临时删掉 Setting 表里的两行 api_key，保留 base_url。
 * 这样配置来源仍然是数据库（不会回落到 .env 里那份），但 isProviderReady()
 * 变成 false，pipeline 自动走 Mock。
 *
 * 安全兜底：
 *   - 主流程结束调 restoreKeys()
 *   - 注册了 process exit 钩子，异常退出 / Ctrl+C 也会还原
 *   - SQLite 用的是同步 API，在 exit 钩子里执行是安全的
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  // node:sqlite 在 22.x 仍标实验特性，每次 import 都会打一行警告，这里静音
  if (String(warning).includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...rest);
};

// node:sqlite 从 Node 22.5 起才有。低版本直接跳过 Mock 切换：
// 没配 Key 的人本来就跑在 Mock 上，配了 Key 的人会看到少量断言失败——
// 那是"真实识别接口认不出假音频"，不是代码坏了。
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function resolveDbPath() {
  try {
    const env = readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^\s*DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
    if (m) return path.resolve(ROOT, "prisma", m[1]);
  } catch {
    // 没有 .env 就用默认路径
  }
  return path.join(ROOT, "prisma", "dev.db");
}

const DB_PATH = resolveDbPath();
const KEY_ROWS = ["asr_api_key", "llm_api_key"];

let savedKeyRows = null;

/** 摘掉真实 Key，返回被停用的行数（0 表示本来就是 Mock，或当前 Node 不支持） */
export function enterMockMode() {
  if (!DatabaseSync || !existsSync(DB_PATH)) return 0;
  const placeholders = KEY_ROWS.map(() => "?").join(",");
  const db = new DatabaseSync(DB_PATH);
  try {
    savedKeyRows = db
      .prepare(`SELECT key, value, updatedAt FROM Setting WHERE key IN (${placeholders})`)
      .all(...KEY_ROWS);
    if (savedKeyRows.length > 0) {
      db.prepare(`DELETE FROM Setting WHERE key IN (${placeholders})`).run(...KEY_ROWS);
    }
    return savedKeyRows.length;
  } finally {
    db.close();
  }
}

/** 还原 Key，返回还原的行数。可重复调用，已还原时返回 0 */
export function restoreKeys() {
  if (!savedKeyRows || savedKeyRows.length === 0) return 0;
  const rows = savedKeyRows;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const db = new DatabaseSync(DB_PATH);
      try {
        const stmt = db.prepare("INSERT OR REPLACE INTO Setting (key, value, updatedAt) VALUES (?, ?, ?)");
        for (const row of rows) stmt.run(row.key, row.value, row.updatedAt);
      } finally {
        db.close();
      }
      savedKeyRows = null;
      return rows.length;
    } catch (err) {
      if (attempt === 2) {
        console.error("\n[!] 恢复 API Key 失败，请到设置页重新填写一次：", err.message);
      }
    }
  }
  return 0;
}

// 无论怎么退出都兜住，避免用户的 Key 被留在"已删除"状态
process.on("exit", restoreKeys);
