import type { ProviderConfig } from "./config";

/**
 * 服务商连通性探测：设置页的「测试连接」与命令行的 check-api 共用同一套判断逻辑。
 * 只验证可达性与鉴权，不依赖真实音频，所以静音返回空文本是正常的。
 */

export type ProbeResult = {
  ok: boolean;
  detail: string;
  models?: string[];
};

/** 1 秒 16kHz 单声道静音 WAV */
export function silentWav(seconds = 1, rate = 16000): Buffer {
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

function hintFor(status: number, kind: "asr" | "llm"): string {
  if (status === 401 || status === 403) return "Key 无效，或该服务未开通此能力";
  if (status === 404) {
    return kind === "asr"
      ? "模型名不对，或这家不提供语音识别接口"
      : "模型名不对，或这家不提供对话接口";
  }
  if (status === 402) return "余额不足";
  if (status === 429) return "调用频率或额度超限";
  if (status === 400) return kind === "asr" ? "音频格式或模型名不被接受" : "请求参数不被接受";
  return "服务返回异常";
}

/** 列出账号可用模型；拉不到就返回 null，不影响后续判断 */
export async function listModels(cfg: ProviderConfig): Promise<string[] | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

export async function probeLlm(cfg: ProviderConfig): Promise<ProbeResult> {
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "只回复两个字：可用" }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 160);
      return { ok: false, detail: `HTTP ${res.status} · ${hintFor(res.status, "llm")}｜${body}` };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim().slice(0, 20);
    return { ok: true, detail: `${cfg.model} 回复「${text || "（空）"}」` };
  } catch (err) {
    return {
      ok: false,
      detail: `请求失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function probeAsr(cfg: ProviderConfig): Promise<ProbeResult> {
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(silentWav())], { type: "audio/wav" }), "silence.wav");
    form.append("model", cfg.model);

    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(40000),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return { ok: false, detail: `HTTP ${res.status} · ${hintFor(res.status, "asr")}｜${body}` };
    }

    const data = (await res.json().catch(() => ({}))) as { text?: string };
    return {
      ok: true,
      detail: `${cfg.model} 可用（静音返回「${(data.text ?? "").slice(0, 8)}」，属正常）`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: `请求失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
