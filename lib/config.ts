import { prisma } from "./prisma";

/**
 * 配置来源：数据库（应用内设置）优先，其次 .env。
 * 数据库里只要填了地址或 Key，就以数据库为准，不再和 .env 混用——
 * 避免出现"地址来自设置页、Key 来自旧 .env"这种对不上的情况。
 */

export type ProviderSource = "db" | "env" | "none";

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: ProviderSource;
};

export type AppConfig = {
  asr: ProviderConfig;
  llm: ProviderConfig;
};

export const SETTING_KEYS = {
  asrBaseUrl: "asr_base_url",
  asrApiKey: "asr_api_key",
  asrModel: "asr_model",
  llmBaseUrl: "llm_base_url",
  llmApiKey: "llm_api_key",
  llmModel: "llm_model",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const DEFAULT_ASR_MODEL = "whisper-1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";

const CACHE_MS = 2000;

const globalCache = globalThis as unknown as {
  __echonote_config__?: { at: number; value: AppConfig };
};

function trimBase(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

function pick(
  db: { baseUrl?: string; apiKey?: string; model?: string },
  env: { baseUrl?: string; apiKey?: string; model?: string },
  defaultModel: string,
): ProviderConfig {
  const hasDb = Boolean(db.baseUrl || db.apiKey);
  if (hasDb) {
    return {
      baseUrl: trimBase(db.baseUrl),
      apiKey: (db.apiKey ?? "").trim(),
      model: (db.model ?? "").trim() || defaultModel,
      source: "db",
    };
  }

  if (env.baseUrl && env.apiKey) {
    return {
      baseUrl: trimBase(env.baseUrl),
      apiKey: env.apiKey.trim(),
      model: (env.model ?? "").trim() || defaultModel,
      source: "env",
    };
  }

  return { baseUrl: "", apiKey: "", model: defaultModel, source: "none" };
}

function build(stored: Record<string, string>): AppConfig {
  return {
    asr: pick(
      {
        baseUrl: stored[SETTING_KEYS.asrBaseUrl],
        apiKey: stored[SETTING_KEYS.asrApiKey],
        model: stored[SETTING_KEYS.asrModel],
      },
      {
        baseUrl: process.env.ASR_BASE_URL,
        apiKey: process.env.ASR_API_KEY,
        model: process.env.ASR_MODEL,
      },
      DEFAULT_ASR_MODEL,
    ),
    llm: pick(
      {
        baseUrl: stored[SETTING_KEYS.llmBaseUrl],
        apiKey: stored[SETTING_KEYS.llmApiKey],
        model: stored[SETTING_KEYS.llmModel],
      },
      {
        baseUrl: process.env.OPENAI_BASE_URL,
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      },
      DEFAULT_LLM_MODEL,
    ),
  };
}

/** 读取当前生效配置（带 2 秒缓存，避免每次渲染都查库） */
export async function getAppConfig(force = false): Promise<AppConfig> {
  const cached = globalCache.__echonote_config__;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  let stored: Record<string, string> = {};
  try {
    const rows = await prisma.setting.findMany();
    stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    // 表还没建（例如刚 clone 还没 db push）时退化为只用 .env
  }

  const value = build(stored);
  globalCache.__echonote_config__ = { at: Date.now(), value };
  return value;
}

export function invalidateConfigCache() {
  globalCache.__echonote_config__ = undefined;
}

export function isProviderReady(p: ProviderConfig): boolean {
  return Boolean(p.baseUrl && p.apiKey);
}

/** 只显示首尾各 4 位，避免把明文密钥回传到浏览器 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
