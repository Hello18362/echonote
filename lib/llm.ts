import type { SummaryResult } from "./types";
import { getAppConfig, isProviderReady, type ProviderConfig } from "./config";
import {
  actionToTodo,
  normalizeNote,
  renderMeetingNote,
  type MeetingNote,
} from "./meetingNote";

/**
 * 大模型纪要抽象层：未配置服务时自动降级为 Mock。
 *
 * 两个关键点，都是为了"别把一场会写敷衍"：
 * 1. 不截断。长逐字稿先分段提炼，再汇总成纪要，全文都会过一遍模型。
 * 2. 结构化。模型吐 JSON 字段（议题/决策/行动项），排版由 meetingNote 负责，
 *    这样页面上是分节纪要、导出 Word 也还是分节纪要，不会退化成一坨摘要。
 */

/** 单段送给模型的字符上限；再长就切 */
const CHUNK_CHARS = 5000;
/** 低于这个长度一次到位，不分段 */
const DIRECT_LIMIT = 7000;
/** 分段提炼的并发数，太高容易被中转服务限流；4 路能让 2 小时的录音一轮发完 */
const MAP_CONCURRENCY = 4;
/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT = 180_000;

const RULES = `硬性规则（违反即为错误）：
1. 只使用逐字稿里真实出现的信息。不补充背景知识，不推测说话人动机，不编造人名、数字、日期、机构、文件。
2. 逐字稿里没提到负责人或截止时间，就写「未明确」，绝不猜测。
3. 逐字稿来自语音识别，有错别字、口头语、重复、识别错误。要理解真实意图再归纳，不要把识别错误当成事实陈述。
4. 具体优先。能写「埋点补到 9/12，剩 3 个卡在风控确认命名」就不要写「埋点工作取得进展」。
5. 不写「本次会议进行了深入讨论」「大家积极发言」这类空话。每条要点必须有实质信息。
6. 忠实于原意。说话人表达的是建议还是决定，要分清楚；不要把提议写成已决定。
7. 不要评价逐字稿本身的质量（不写「部分表述不清」「内容不连贯」这种元评论）。听不清的地方就不写，或放进待确认。`;

const OUTPUT_SHAPE = `按以下 JSON 输出，不要 markdown 代码块、不要任何解释文字：
{
  "title": "会议主题，12 字以内，要具体",
  "overview": "3-6 句话。说清这是什么会/什么场合、主要讨论了哪几件事、最后达成什么。",
  "sections": [
    {
      "heading": "议题名，8-15 字",
      "points": ["该议题下的讨论要点。每条 20-60 字，写清谁提了什么、依据是什么、分歧在哪"],
      "conclusion": "该议题的结论或共识；没有结论就填空字符串"
    }
  ],
  "decisions": ["已经拍板的决定，一条一句，要具体"],
  "actions": [
    { "who": "负责人；没说就写 未明确", "what": "要做的事，动词开头", "when": "截止时间；没说就写 未明确" }
  ],  "open": ["讨论了但没有结论、需要之后再定的事"],
  "keywords": ["5-8 个关键词，用于检索"]
}
sections 一般 3-8 个，按讨论内容的逻辑切分，不要按时间顺序记流水账。
actions 只列**具体可执行**的任务：有明确动作和对象，完成后能看出做没做。泛泛的要求（「要服务同学」「要提高认识」「要做好本职工作」）不算行动项，一律不列。宁少勿滥，通常 3-8 条。`;

const FINAL_PROMPT = `你是资深会议记录员，要为一段真实录音写正式会议纪要。
读者是没参会的人，他看完要能回答四个问题：这会开了什么、结论是什么、谁要做什么、还有什么没定。

${RULES}

${OUTPUT_SHAPE}`;

const MAP_PROMPT = `你在为一段很长的会议录音做分段速记。下面是整段逐字稿的其中一段。
你的任务只是把这一段里的事实性信息提取出来，供之后汇总成纪要。

只输出 JSON，不要任何解释：
{
  "topics": ["这一段在讨论什么，一句一个"],
  "points": ["具体观点、数据、结论。每条 20-60 字，保留人名、数字、时间、文件名"],
  "decisions": ["这一段里明确拍板的决定，没有就空数组"],
  "actions": [{ "who": "负责人或未明确", "what": "要做的事", "when": "时间或未明确" }],
  "terms": ["出现的人名、机构、项目名、系统名等专有名词"]
}

${RULES}

补充：
- 只写这一段里出现的内容，不要去推测上下文。
- 这一段如果是开场寒暄、点名、念 PPT 标题、设备调试，没有实质内容就返回空数组。`;

const MOCK_SUMMARY: SummaryResult = {
  summary: `## 会议概要

【演示数据 · 与你的录音无关】当前未配置大模型服务，以下是内置示例纪要，用来展示真实生成时的排版。

这是一次项目周会，三人参加。会议同步了埋点补齐、iOS 白屏修复、新版本上线材料三件事的进度，确定了灰度发布的时间表，并调整了监控告警阈值。

## 埋点补齐

- 登录流程共 12 个事件，已补 9 个，剩余 3 个卡在风控确认手机号验证环节的事件命名
- 注册页存在埋点重复上报，导致数据量虚高约 10%，不影响主漏斗结论，但需要修复

**结论**：本周三前与风控对齐命名，当天补齐；重复上报问题当天合并修复。

## iOS 白屏

- 定位为详情页使用新版 Intersection Observer 写法，低版本 Safari 不支持，导致首屏渲染中断
- 已改为兜底方案，本地验证通过，仍需真机验证，重点是 iPhone 12 及以下机型

**结论**：明天借测试机跑一轮，结果同步到群里。

## 新版本上线材料

- release note 初稿完成，缺运营的推广文案和设计的三张新版本截图
- 王强提议本次走灰度：先放 10%，观察 24 小时无异常再全量

**结论**：同意灰度。排期为下周一提测、周三灰度、周五视数据全量。

## 关键决策

1. 新版本采用灰度发布，先放 10% 观察 24 小时再全量
2. 排期定为下周一提测、周三灰度、周五视数据决定是否全量
3. 监控告警的错误率阈值从 0.5% 调整到 1%，并增加连续 5 分钟判定

## 行动项

| 事项 | 负责人 | 时间 |
| --- | --- | --- |
| 与风控对齐埋点事件命名，补齐剩余 3 个事件 | 李娜 | 本周三 |
| 提交并合并注册页埋点重复上报的修复 | 李娜 | 当天 |
| 借测试机完成 iOS 真机验证（重点 iPhone 12 及以下） | 王强 | 明天 |
| 催运营与设计补齐推广文案和三张截图 | 王强 | 最迟周四 |
| 调整告警规则并说明调整原因 | 王强 | 未明确 |
| 整理会议待办发群，标注责任人与截止时间 | 李娜 | 当天 |

## 待确认

- 灰度期间的数据观察指标和停止条件尚未明确`,
  todos: [
    "李娜：与风控对齐埋点事件命名，补齐剩余 3 个事件（本周三）",
    "李娜：提交并合并注册页埋点重复上报的修复（当天）",
    "王强：借测试机完成 iOS 真机验证（明天）",
    "王强：催运营与设计补齐推广文案和三张截图（最迟周四）",
    "王强：调整告警规则并说明调整原因",
    "李娜：整理会议待办发群，标注责任人与截止时间（当天）",
  ],
  keyPoints: [
    "项目周会",
    "埋点补齐",
    "iOS 白屏",
    "真机验证",
    "灰度发布",
    "告警阈值",
  ],
};

/**
 * 语音识别结果里混着表情符号和重复标点，会打断模型对句子的理解。
 * 只清明显是噪声的东西，正文一个字不动。
 */
export function cleanTranscript(raw: string): string {
  // 不用带 u 标志的正则：tsconfig 目标是 es5，编译期会报 TS1501
  let stripped = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    const isEmoji =
      (cp >= 0x1f000 && cp <= 0x1faff) || // 表情、符号、补充符号
      (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号、装饰符号
      (cp >= 0x2190 && cp <= 0x21ff) || // 箭头
      cp === 0xfe0f || // 变体选择符
      cp === 0x200d; // 零宽连接符
    stripped += isEmoji ? " " : ch;
  }

  return (
    stripped
      // 连续重复标点：「。.。」「。。。」
      .replace(/([。．.！!？?])\s*(?:[。．.！!？?]\s*)+/g, "$1")
      // 只由标点/空白组成的碎片
      .replace(/^[\s.。!?！？，,、;；:：]+$/gm, "")
      .replace(/[ \t\u3000]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** 按句末标点切句，保留标点本身（不能用 lookbehind，tsconfig 目标是 es5） */
function splitSentences(text: string): string[] {
  const marks = "。！？!?\n";
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (marks.includes(ch)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 按句子切成不超过 size 的块，尽量不在一句话中间断开 */
export function splitTranscript(text: string, size = CHUNK_CHARS): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let buf = "";

  for (const s of sentences) {
    if (!s) continue;
    // 单句本身超长（没有标点的长段落），硬切
    if (s.length > size) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
      continue;
    }
    if (buf.length + s.length > size && buf) {
      chunks.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks.filter((c) => c.trim().length > 0);
}

/** 从模型回复里抠出 JSON（兼容被代码块包裹、前后带说明的情况） */
export function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型返回内容不是合法 JSON");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

type ChatMessage = { role: "system" | "user"; content: string };

/** 429 / 5xx 是暂时的，退避重试；4xx（除 429）是配置或请求问题，重试也没用 */
async function postChat(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  temperature: number,
): Promise<unknown> {
  const base = cfg.baseUrl;
  const url = `${base}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };

  const attempt = async (useJsonFormat: boolean): Promise<Response> => {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature,
    };
    if (useJsonFormat) body.response_format = { type: "json_object" };

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
  };

  let lastErr = "";
  for (let i = 0; i < 3; i += 1) {
    let res: Response;
    try {
      res = await attempt(true);
      // 部分中转服务不认 response_format，去掉再试
      if (!res.ok && [400, 404, 422].includes(res.status)) {
        res = await attempt(false);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (i < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(`调用大模型超时或网络失败：${lastErr}`);
    }

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("大模型返回内容为空");
      return extractJson(content);
    }

    const text = (await res.text()).slice(0, 200);
    // 内容被安全策略拦截时重试无意义
    if ([400, 401, 403, 404, 422].includes(res.status)) {
      throw new Error(`大模型调用失败：${res.status} ${text}`);
    }
    lastErr = `${res.status} ${text}`;
    if (i < 2) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }

  throw new Error(`大模型调用失败（已重试 3 次）：${lastErr}`);
}

type ChunkNotes = {
  topics: string[];
  points: string[];
  decisions: string[];
  actions: Array<{ who?: string; what?: string; when?: string }>;
  terms: string[];
};

function normalizeChunk(raw: unknown): ChunkNotes {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  return {
    topics: list(r.topics),
    points: list(r.points),
    decisions: list(r.decisions),
    actions: Array.isArray(r.actions)
      ? (r.actions as Array<Record<string, unknown>>).filter((a) => a && typeof a.what === "string")
      : [],
    terms: list(r.terms),
  };
}

/** 并发受限的 map，任何一段失败就整体失败（宁可不生成，也不要生成半份纪要） */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 分段速记：把长逐字稿的每一段都过一遍模型 */
async function draftFromChunks(
  chunks: string[],
  cfg: ProviderConfig,
): Promise<ChunkNotes[]> {
  return mapLimit(chunks, MAP_CONCURRENCY, async (chunk, i) => {
    const raw = await postChat(
      cfg,
      [
        { role: "system", content: MAP_PROMPT },
        {
          role: "user",
          content: `这是第 ${i + 1} 段，共 ${chunks.length} 段。\n\n${chunk}`,
        },
      ],
      0.2,
    );
    return normalizeChunk(raw);
  });
}

/** 把各段速记拼成给汇总步骤的输入 */
function mergeNotes(chunks: ChunkNotes[]): string {
  const pick = (fn: (c: ChunkNotes) => string[]) => chunks.flatMap(fn);

  const lines: string[] = [];

  const topics = pick((c) => c.topics);
  if (topics.length) lines.push(`讨论主题：\n${topics.map((t) => `- ${t}`).join("\n")}`);

  const points = pick((c) => c.points);
  if (points.length) lines.push(`要点：\n${points.map((p) => `- ${p}`).join("\n")}`);

  const decisions = pick((c) => c.decisions);
  if (decisions.length) lines.push(`提到的决定：\n${decisions.map((d) => `- ${d}`).join("\n")}`);

  const actions = chunks.flatMap((c) => c.actions);
  if (actions.length) {
    lines.push(
      `提到的任务：\n${actions
        .map((a) => `- ${a.who || "未明确"}：${a.what || ""}（${a.when || "未明确"}）`)
        .join("\n")}`,
    );
  }

  const terms = Array.from(new Set(pick((c) => c.terms)));
  if (terms.length) lines.push(`专有名词：${terms.join("、")}`);

  return lines.join("\n\n");
}

function hasContent(note: MeetingNote): boolean {
  return Boolean(note.overview) || note.sections.length > 0 || note.decisions.length > 0;
}

export async function summarize(transcript: string): Promise<SummaryResult> {
  const cfg = await getAppConfig();

  if (!isProviderReady(cfg.llm)) {
    await new Promise((r) => setTimeout(r, 1600));
    return MOCK_SUMMARY;
  }

  const llm = cfg.llm;

  const text = cleanTranscript(transcript);
  if (!text) throw new Error("逐字稿是空的，没有可以总结的内容");

  let note: MeetingNote;

  if (text.length <= DIRECT_LIMIT) {
    // 短录音：一次到位
    const raw = await postChat(
      llm,
      [
        { role: "system", content: FINAL_PROMPT },
        { role: "user", content: `逐字稿如下：\n\n${text}` },
      ],
      0.2,
    );
    note = normalizeNote(raw);
  } else {
    // 长录音：分段提炼 → 汇总。全文都会过一遍模型，不截断
    const chunks = splitTranscript(text);
    const notes = await draftFromChunks(chunks, llm);

    const raw = await postChat(
      llm,
      [
        {
          role: "system",
          content: `${FINAL_PROMPT}

补充：这次给你的输入不是原始逐字稿，而是一位助手对整场会议按时间顺序做的分段速记（共 ${chunks.length} 段）。
请把这些速记合并成一份完整纪要：合并重复的内容、把散落各段的相关讨论归到同一个议题下、
按重要性排序，不要按分段顺序照抄。仍然严格遵守上面所有规则，不要添加速记里没有的信息。`,
        },
        { role: "user", content: mergeNotes(notes) },
      ],
      0.2,
    );
    note = normalizeNote(raw);
  }

  if (!hasContent(note)) {
    throw new Error("模型没能从这段录音里提炼出有效内容，请检查逐字稿或稍后重试");
  }

  const summary = renderMeetingNote(note);
  if (!summary.trim()) {
    throw new Error("生成的纪要是空的，请重试");
  }

  return {
    summary,
    todos: note.actions.map(actionToTodo).filter(Boolean),
    keyPoints: note.keywords.slice(0, 8),
  };
}
