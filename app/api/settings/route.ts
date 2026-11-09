import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAppConfig,
  invalidateConfigCache,
  isProviderReady,
  maskKey,
  SETTING_KEYS,
} from "@/lib/config";
import { audioUsage, orphanAudio } from "@/lib/audioStore";
import { accessEnabled } from "@/lib/access";

export const dynamic = "force-dynamic";

type ProviderInput = { baseUrl?: unknown; apiKey?: unknown; model?: unknown };

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 只接受 http(s) 地址，去掉结尾斜杠；空串表示"没填" */
function normalizeBase(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return null;
  return v;
}

async function snapshot() {
  const cfg = await getAppConfig(true);
  const usage = audioUsage();

  // 孤儿音频：删除记录时文件被占用没删干净的残留，设置页给个清理入口
  let orphan = { count: 0, bytes: 0 };
  try {
    const rows = await prisma.recording.findMany({ select: { id: true } });
    orphan = orphanAudio(rows.map((r) => r.id));
  } catch {
    // 统计失败不影响设置页其他内容
  }

  return {
    asr: {
      baseUrl: cfg.asr.baseUrl,
      model: cfg.asr.model,
      source: cfg.asr.source,
      ready: isProviderReady(cfg.asr),
      keyMask: maskKey(cfg.asr.apiKey),
    },
    llm: {
      baseUrl: cfg.llm.baseUrl,
      model: cfg.llm.model,
      source: cfg.llm.source,
      ready: isProviderReady(cfg.llm),
      keyMask: maskKey(cfg.llm.apiKey),
    },
    audio: usage,
    orphan,
    // 设了访问口令才显示"退出登录"，本地不设口令时这一栏不出现
    accessGate: accessEnabled(),
  };
}

/** GET：当前生效配置（密钥只回传掩码） */
export async function GET() {
  try {
    return NextResponse.json(await snapshot());
  } catch (err) {
    console.error("[api] 读取设置失败", err);
    return NextResponse.json({ error: "读取设置失败" }, { status: 500 });
  }
}

/** PUT：保存配置；apiKey 留空表示沿用原值 */
export async function PUT(request: Request) {
  let body: { asr?: ProviderInput; llm?: ProviderInput };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const cfg = await getAppConfig(true);

  const groups: Array<{
    input?: ProviderInput;
    current: { baseUrl: string; apiKey: string; model: string };
    keys: { base: string; key: string; model: string };
  }> = [
    {
      input: body.asr,
      current: cfg.asr,
      keys: {
        base: SETTING_KEYS.asrBaseUrl,
        key: SETTING_KEYS.asrApiKey,
        model: SETTING_KEYS.asrModel,
      },
    },
    {
      input: body.llm,
      current: cfg.llm,
      keys: {
        base: SETTING_KEYS.llmBaseUrl,
        key: SETTING_KEYS.llmApiKey,
        model: SETTING_KEYS.llmModel,
      },
    },
  ];

  try {
    for (const group of groups) {
      if (!group.input) continue;

      const baseRaw = typeof group.input.baseUrl === "string" ? group.input.baseUrl : group.current.baseUrl;
      const base = normalizeBase(baseRaw);
      if (base === null) {
        return NextResponse.json(
          { error: "服务地址必须以 http:// 或 https:// 开头" },
          { status: 400 },
        );
      }

      const key = asText(group.input.apiKey) || group.current.apiKey;
      const model = asText(group.input.model) || group.current.model;

      // 地址和 Key 都空 → 清除这一组（回退到 .env 或 Mock）
      if (!base && !key) {
        await prisma.setting.deleteMany({
          where: { key: { in: [group.keys.base, group.keys.key, group.keys.model] } },
        });
        continue;
      }

      const rows: Array<[string, string]> = [
        [group.keys.base, base],
        [group.keys.key, key],
        [group.keys.model, model],
      ];
      for (const [k, v] of rows) {
        await prisma.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
      }
    }

    invalidateConfigCache();
    return NextResponse.json(await snapshot());
  } catch (err) {
    console.error("[api] 保存设置失败", err);
    return NextResponse.json({ error: "保存失败，请查看服务端日志" }, { status: 500 });
  }
}

/** DELETE：清除应用内配置，回退到 .env */
export async function DELETE() {
  try {
    await prisma.setting.deleteMany();
    invalidateConfigCache();
    return NextResponse.json(await snapshot());
  } catch (err) {
    console.error("[api] 清除设置失败", err);
    return NextResponse.json({ error: "清除失败" }, { status: 500 });
  }
}
