import { NextResponse } from "next/server";
import { getAppConfig, type ProviderConfig } from "@/lib/config";
import { listModels, probeAsr, probeLlm } from "@/lib/providerProbe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Target = "asr" | "llm" | "models";

/**
 * POST：测试尚未保存的配置（也可以测试已保存的）
 * body: { target: "asr" | "llm" | "models", baseUrl?, apiKey?, model? }
 * apiKey 留空时用当前生效的密钥，方便"只改模型名先测一下"
 */
export async function POST(request: Request) {
  let body: {
    target?: Target;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, detail: "请求体不是合法 JSON" }, { status: 400 });
  }

  const target = body.target;
  if (target !== "asr" && target !== "llm" && target !== "models") {
    return NextResponse.json({ ok: false, detail: "target 只能是 asr / llm / models" }, { status: 400 });
  }

  const cfg = await getAppConfig(true);
  const current = target === "llm" ? cfg.llm : cfg.asr;

  const baseUrl = (body.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, "");
  const apiKey = (body.apiKey ?? "").trim() || current.apiKey;
  const model = (body.model ?? "").trim() || current.model;

  if (!baseUrl) {
    return NextResponse.json({ ok: false, detail: "请先填写服务地址" }, { status: 200 });
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json({ ok: false, detail: "服务地址必须以 http:// 或 https:// 开头" }, { status: 200 });
  }
  if (!apiKey) {
    return NextResponse.json({ ok: false, detail: "请先填写 API Key" }, { status: 200 });
  }
  if (target !== "models" && !model) {
    return NextResponse.json(
      { ok: false, detail: "请先填写模型名——不确定的话点右边「列出可用模型」，从列表里点一个" },
      { status: 200 },
    );
  }

  const probeCfg: ProviderConfig = { baseUrl, apiKey, model, source: "db" };

  try {
    if (target === "models") {
      const models = await listModels(probeCfg);
      if (!models) {
        return NextResponse.json({ ok: false, detail: "拉取模型列表失败，可能是 Key 无效或该服务不提供 /models" });
      }
      return NextResponse.json({ ok: true, detail: `共 ${models.length} 个模型`, models });
    }

    const result = target === "asr" ? await probeAsr(probeCfg) : await probeLlm(probeCfg);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
