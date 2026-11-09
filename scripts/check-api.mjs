/**
 * OpenAI 兼容服务的连通性自检 + 一键写入 .env
 *
 * 用法：
 *   node scripts/check-api.mjs --help
 *   node scripts/check-api.mjs --provider siliconflow --key sk-xxx
 *   node scripts/check-api.mjs --provider siliconflow --key sk-xxx --write
 *   node scripts/check-api.mjs --base https://api.xxx.com/v1 --key sk-xxx --llm-model gpt-6-luna
 *   node scripts/check-api.mjs            # 从 .env 读取 ASR 与 OPENAI 两组配置
 *
 * 依次验证：① /models 鉴权 ② chat/completions ③ audio/transcriptions
 * --write 只在三项全通过时写入 .env，避免把错配置固化下来。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/* ---------------- 预设服务商 ---------------- */
const PRESETS = {
  siliconflow: {
    label: "硅基流动（国内直连，语音识别免费）",
    base: "https://api.siliconflow.cn/v1",
    asr: "FunAudioLLM/SenseVoiceSmall",
    llm: "Qwen/Qwen3-8B",
    apply: "https://cloud.siliconflow.cn/me/account/ak",
    note: "语音识别模型标注免费；需先完成实名认证才能调用",
  },
  zhipu: {
    label: "智谱 BigModel（国内直连，ASR 按量付费）",
    base: "https://open.bigmodel.cn/api/paas/v4",
    asr: "glm-asr-2512",
    llm: "glm-4-flash",
    apply: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "ASR 与对话共用同一个 Key，接入最省事",
  },
  dashscope: {
    label: "阿里百炼（国内直连，每月有免费转写时长）",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    asr: "paraformer-v2",
    llm: "qwen-plus",
    apply: "https://bailian.console.aliyun.com/",
    note: "兼容层对音频接口的支持随地域/模型而异，脚本会实测",
  },
  openai: {
    label: "OpenAI 官方（需要境外网络与外币卡）",
    base: "https://api.openai.com/v1",
    asr: "whisper-1",
    llm: "gpt-4o-mini",
    apply: "https://platform.openai.com/api-keys",
    note: "",
  },
};

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

if (has("help") || has("h")) {
  console.log(`用法：
  node scripts/check-api.mjs --provider <名字> --key sk-xxx [--write]
  node scripts/check-api.mjs --base https://api.xxx.com/v1 --key sk-xxx [--write]

预设：${Object.keys(PRESETS).join(" / ")}

可覆盖项：
  --asr-model <模型名>   语音识别模型
  --llm-model <模型名>   对话模型
  --write                三项检查全通过后，把配置写进 .env

示例：
  node scripts/check-api.mjs --provider siliconflow --key sk-abc --write`);
  process.exit(0);
}

function readEnv() {
  try {
    return Object.fromEntries(
      readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

const env = readEnv();
const presetName = arg("provider");
const preset = presetName ? PRESETS[presetName] : undefined;

if (presetName && !preset) {
  console.error(`未知预设「${presetName}」，可选：${Object.keys(PRESETS).join(" / ")}`);
  process.exit(1);
}

const base = (arg("base") || preset?.base || env.ASR_BASE_URL || env.OPENAI_BASE_URL || "")
  .replace(/\/+$/, "");
const key = arg("key") || env.ASR_API_KEY || env.OPENAI_API_KEY || "";
// 优先级：命令行 > 预设 > .env > 默认值（显式选了服务商就以预设为准，否则 .env 覆盖预设）
const asrModel =
  arg("asr-model") || preset?.asr || env.ASR_MODEL || "whisper-1";
const llmModel =
  arg("llm-model") || preset?.llm || env.OPENAI_MODEL || "gpt-4o-mini";

if (!base || !key) {
  console.error(
    "缺少参数：需要 --key（+ --provider 或 --base）。用 --help 看可用预设。",
  );
  process.exit(1);
}

/* ---------------- 输出 ---------------- */
const mask = key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "***";
console.log(`服务商:   ${preset ? preset.label : "自定义 / 中转站"}`);
console.log(`服务地址: ${base}`);
console.log(`密钥:     ${mask}（长度 ${key.length}）`);
console.log(`ASR 模型: ${asrModel}`);
console.log(`LLM 模型: ${llmModel}`);
if (preset?.note) console.log(`说明:     ${preset.note}`);
console.log("");

const results = [];
const ok = (name, detail) => {
  results.push({ name, pass: true });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail, hint) => {
  results.push({ name, pass: false });
  console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  if (hint) console.log(`   ${hint}`);
};

/** 1 秒 16kHz 单声道静音 WAV，仅用于验证 /audio/transcriptions 是否可达 */
function silentWav(seconds = 1, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/* ---------------- ① /models ---------------- */
let availableModels = null;
try {
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (res.ok) {
    const data = await res.json();
    availableModels = (data.data || []).map((m) => m.id);
    ok("鉴权通过（/models）", `共 ${availableModels.length} 个模型`);

    const asrHits = availableModels.filter((m) =>
      /whisper|transcribe|asr|sensevoice|paraformer|funasr/i.test(m),
    );
    if (asrHits.length) {
      console.log(`   可用语音模型: ${asrHits.slice(0, 8).join(", ")}`);
    } else {
      console.log("   列表里没有 whisper/transcribe/asr 类模型（部分中转站不暴露音频模型，仍需实测第 ③ 项）");
    }

    if (!availableModels.includes(llmModel)) {
      const guess =
        availableModels.find((m) => /gpt-4o|gpt-4\.1|gpt-5/i.test(m)) ||
        availableModels.find((m) => /qwen3/i.test(m) && !/asr|audio|vl/i.test(m)) ||
        availableModels.find((m) => /deepseek-chat/i.test(m)) ||
        availableModels.find((m) => /glm-4/i.test(m));
      console.log(`   ⚠️ 模型列表里没有「${llmModel}」这个 id`);
      if (guess) console.log(`      疑似可用: ${guess}（可用 --llm-model 指定）`);
    }
  } else {
    const body = (await res.text()).slice(0, 160);
    bad(
      "鉴权失败（/models）",
      `HTTP ${res.status} ${body}`,
      res.status === 401 ? "   → Key 写错了，或这家的 Key 需要在后台单独启用" : "",
    );
  }
} catch (err) {
  bad("无法访问 /models", err.message, "   → 检查网络；国内直连服务不需要代理");
}

/* ---------------- ② chat/completions ---------------- */
let chatModelUsed = llmModel;
try {
  const call = async (model) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复两个字：可用" }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(45000),
    });

  let res = await call(chatModelUsed);
  let bodyText = "";

  // 模型名不对时，用 /models 里挑一个再试一次
  if (!res.ok && availableModels?.length) {
    const guess =
      availableModels.find((m) => /gpt-4o-mini/i.test(m)) ||
      availableModels.find((m) => /qwen3/i.test(m) && !/asr|audio|vl/i.test(m)) ||
      availableModels.find((m) => /deepseek-chat/i.test(m)) ||
      availableModels.find((m) => /glm-4-flash/i.test(m));
    if (guess && guess !== chatModelUsed) {
      console.log(`   ↻ 「${chatModelUsed}」不可用，自动改用「${guess}」重试`);
      res = await call(guess);
      chatModelUsed = guess;
    }
  }

  if (res.ok) {
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    ok("对话接口可用", `${chatModelUsed} 回复「${text.trim().slice(0, 20)}」`);
  } else {
    bodyText = (await res.text()).slice(0, 200);
    bad(
      "对话接口失败",
      `HTTP ${res.status} ${bodyText}`,
      res.status === 404
        ? "   → 模型 id 不对，对着上面列出的模型名逐字复制"
        : res.status === 402 || res.status === 403
          ? "   → 余额不足或该模型未开通"
          : "",
    );
  }
} catch (err) {
  bad("对话接口异常", err.message);
}

/* ---------------- ③ audio/transcriptions ---------------- */
let asrModelUsed = asrModel;
try {
  const call = async (model) => {
    const form = new FormData();
    form.append("file", new Blob([silentWav()], { type: "audio/wav" }), "silence.wav");
    form.append("model", model);
    return fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  };

  let res = await call(asrModelUsed);

  if (!res.ok && availableModels?.length) {
    const guess = availableModels.find((m) =>
      /sensevoice|whisper-1|transcribe|paraformer|asr/i.test(m),
    );
    if (guess && guess !== asrModelUsed) {
      console.log(`   ↻ 「${asrModelUsed}」不可用，自动改用「${guess}」重试`);
      res = await call(guess);
      asrModelUsed = guess;
    }
  }

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    ok(
      "语音识别接口可用",
      `模型 ${asrModelUsed}（静音返回「${(data.text ?? "").slice(0, 10)}」，属正常）`,
    );
  } else {
    const body = (await res.text()).slice(0, 240);
    const hint =
      res.status === 404
        ? "   → 这家不提供音频接口，或模型名不对。换 --provider siliconflow 只需一个免费 Key"
        : res.status === 401 || res.status === 403
          ? "   → Key 没有音频权限，需单独开通/实名"
          : res.status === 400
            ? "   → 多半是模型名或音频格式不被接受"
            : "";
    bad("语音识别接口失败", `HTTP ${res.status} ${body}`, hint);
  }
} catch (err) {
  bad("语音识别接口异常", err.message);
}

/* ---------------- 汇总 ---------------- */
const pass = results.filter((r) => r.pass).length;
console.log(`\n结果：${pass} / ${results.length} 项通过`);

const allPass = pass === results.length;

if (has("write")) {
  if (!allPass) {
    console.log("存在未通过项，未写入 .env。");
  } else {
    writeEnv({ base, key, asrModel: asrModelUsed, llmModel: chatModelUsed });
  }
} else if (allPass) {
  console.log("\n复现这条配置，把下面几行贴进 .env：\n");
  console.log(`ASR_BASE_URL="${base}"
ASR_API_KEY="${key}"
ASR_MODEL="${asrModelUsed}"

OPENAI_BASE_URL="${base}"
OPENAI_API_KEY="${key}"
OPENAI_MODEL="${chatModelUsed}"`);
  console.log("\n或者直接加 --write 让我写进去。");
}

process.exit(allPass ? 0 : 1);

/* ---------------- 写 .env ---------------- */
function writeEnv({ base, key, asrModel, llmModel }) {
  const path = ".env";
  const next = {
    ASR_BASE_URL: `"${base}"`,
    ASR_API_KEY: `"${key}"`,
    ASR_MODEL: `"${asrModel}"`,
    OPENAI_BASE_URL: `"${base}"`,
    OPENAI_API_KEY: `"${key}"`,
    OPENAI_MODEL: `"${llmModel}"`,
  };

  let lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const done = new Set();

  lines = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)\s*=/);
    if (!m || !(m[2] in next)) return line;
    done.add(m[2]);
    return `${m[2]}=${next[m[2]]}`;
  });

  for (const [k, v] of Object.entries(next)) {
    if (!done.has(k)) lines.push(`${k}=${v}`);
  }

  writeFileSync(path, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
  console.log(`已写入 .env：ASR=${asrModel}，LLM=${llmModel}`);
  console.log("重启服务后生效：先 Ctrl+C 停掉，再 npm run dev");
}
