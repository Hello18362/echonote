/**
 * EchoNote 链路自检脚本
 * 用法：node scripts/smoke.mjs [baseURL]
 * 默认 http://127.0.0.1:3000
 */

import { enterMockMode, restoreKeys } from "./test-mode.mjs";
import { installAuthFetch, loginCookie } from "./access-client.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra = "") {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` \x1b[90m${extra}\x1b[0m` : ""}`);
}

function bad(name, detail) {
  fail++;
  failures.push(`${name} :: ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[31m${detail}\x1b[0m`);
}

function check(name, cond, detail = "") {
  if (cond) ok(name, detail);
  else bad(name, detail || "断言失败");
  return cond;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function fakeAudio(size = 4096) {
  return new Blob([new Uint8Array(size).fill(7)], { type: "audio/webm" });
}

function createForm(duration, withAudio = true, size = 4096) {
  const fd = new FormData();
  if (withAudio) fd.append("audio", fakeAudio(size), "a.webm");
  fd.append("duration", String(duration));
  return fd;
}

async function main() {
  console.log(`\n\x1b[1mEchoNote 链路自检 → ${BASE}\x1b[0m\n`);

  // 配了访问口令时先换一张 cookie，否则所有接口都会被门禁挡成 401
  try {
    const cookie = await loginCookie(BASE);
    if (cookie) {
      installAuthFetch(BASE, cookie);
      console.log("\x1b[90m（服务已开启访问口令，自检已自动登录）\x1b[0m\n");
    }
  } catch (err) {
    console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : err}\x1b[0m`);
    console.error("  .env 里的 ACCESS_PASSWORD 和正在运行的服务对不上？改完记得重启服务。\n");
    process.exit(1);
  }

  const disabled = enterMockMode();
  if (disabled > 0) {
    console.log(
      `\x1b[90m（检测到已配置真实 Key，测试期间临时停用 ${disabled} 项，改用 Mock；结束时自动恢复）\x1b[0m\n`,
    );
    await sleep(2600); // 服务端配置缓存 2s，等它过期再开始
  }

  // ---------- 1. 页面可访问 ----------
  console.log("1) 页面渲染");
  for (const [path, label] of [
    ["/", "首页"],
    ["/record", "录音页"],
  ]) {
    const res = await fetch(BASE + path);
    const html = await res.text();
    check(`${label} ${path} 返回 200`, res.status === 200, `status=${res.status}`);
    check(`${label} 无服务端错误`, !html.includes("Application error") && !html.includes('"statusCode":500'));
  }

  // ---------- 2. 列表接口 ----------
  console.log("\n2) 列表接口");
  let res = await fetch(`${BASE}/api/recordings`);
  let data = await json(res);
  check("GET /api/recordings 200", res.status === 200, `status=${res.status}`);
  check("返回 items 数组", Array.isArray(data?.items), JSON.stringify(data)?.slice(0, 80));

  // ---------- 3. 创建校验 ----------
  console.log("\n3) 创建接口校验");
  res = await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(10, false) });
  check("缺音频 → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(0) });
  check("时长为 0 → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(NaN) });
  check("时长非法 → 400", res.status === 400, `status=${res.status}`);

  // ---------- 4. 创建成功 ----------
  console.log("\n4) 创建成功");
  res = await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(95) });
  data = await json(res);
  const id = data?.id;
  check("POST 创建 → 201 且返回 id", res.status === 201 && !!id, `status=${res.status} id=${id}`);
  if (!id) return finish();

  // ---------- 5. 处理流程 ----------
  console.log("\n5) 处理流程（状态机）");
  res = await fetch(`${BASE}/api/recordings/${id}/process`, { method: "POST" });
  check("POST process → 202", res.status === 202, `status=${res.status}`);

  // 轮询间隔要足够小：Mock 模式下转写 + 总结合起来可能不到 400ms，
  // 间隔太大会直接跳过中间状态，断言就变成靠运气。
  const seen = new Set();
  let final = null;
  for (let i = 0; i < 200; i++) {
    await sleep(80);
    const r = await fetch(`${BASE}/api/recordings/${id}`);
    const d = await json(r);
    seen.add(d.status);
    if (d.status === "done" || d.status === "error") {
      final = d;
      break;
    }
  }
  check("最终状态为 done", final?.status === "done", `status=${final?.status} err=${final?.error ?? ""}`);
  check("中途出现过 transcribing", seen.has("transcribing"), [...seen].join(","));
  check("中途出现过 summarizing", seen.has("summarizing"), [...seen].join(","));
  check("逐字稿 ≥300 字", (final?.transcript?.length ?? 0) >= 300, `${final?.transcript?.length} 字`);
  check("摘要有内容", (final?.summary?.length ?? 0) > 20, `${final?.summary?.length} 字`);
  check("待办已解析为数组", Array.isArray(final?.todos) && final.todos.length > 0, `${final?.todos?.length} 条`);
  check("关键词已解析为数组", Array.isArray(final?.keyPoints) && final.keyPoints.length >= 5, `${final?.keyPoints?.length} 个`);

  // ---------- 6. 重复触发 ----------
  console.log("\n6) 幂等性");
  res = await fetch(`${BASE}/api/recordings/${id}/process`, { method: "POST" });
  check("已完成记录再次 process 不重复处理", res.status === 200 || res.status === 202, `status=${res.status}`);

  // ---------- 6.1 重新处理 ----------
  console.log("\n6.1) 重新处理（force）");
  res = await fetch(`${BASE}/api/recordings/${id}/process?force=1`, { method: "POST" });
  check("force=1 能重新触发已完成记录", res.status === 202, `status=${res.status}`);
  let retried;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    retried = await json(await fetch(`${BASE}/api/recordings/${id}`));
    if (retried?.status === "done" || retried?.status === "error") break;
  }
  check("重新处理后仍是 done", retried?.status === "done", `status=${retried?.status}`);

  // ---------- 6.2 待办勾选持久化 ----------
  console.log("\n6.2) 待办勾选");
  res = await fetch(`${BASE}/api/recordings/${id}/todos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: [0, 2, 999, -1] }),
  });
  data = await json(res);
  check("非法下标被过滤", JSON.stringify(data?.done) === "[0,2]", JSON.stringify(data?.done));
  data = await json(await fetch(`${BASE}/api/recordings/${id}`));
  check("勾选状态已持久化", JSON.stringify(data?.todosDone) === "[0,2]", JSON.stringify(data?.todosDone));

  res = await fetch(`${BASE}/api/recordings/${id}/todos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: "x" }),
  });
  check("done 不是数组 → 400", res.status === 400, `status=${res.status}`);

  // ---------- 6.3 音频落盘 ----------
  console.log("\n6.3) 音频落盘");
  try {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("data/audio");
    check("音频文件已写入 data/audio", files.some((f) => f.startsWith(id)), files.filter((f) => f.startsWith(id)).slice(0, 2).join(","));
  } catch {
    check("音频文件已写入 data/audio", false, "目录不存在");
  }

  // ---------- 6.4 设置接口 ----------
  console.log("\n6.4) 设置接口");
  res = await fetch(`${BASE}/api/settings`);
  data = await json(res);
  check("GET /api/settings 200", res.status === 200, `status=${res.status}`);
  check("返回 asr / llm / audio 结构", Boolean(data?.asr && data?.llm && data?.audio));
  check("不返回明文密钥", !JSON.stringify(data).match(/sk-[A-Za-z0-9]{16,}/), "");

  res = await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asr: { baseUrl: "api.example.com", apiKey: "sk-x" } }),
  });
  check("非法地址 → 400（不落库）", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/settings/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "nope" }),
  });
  check("非法 target → 400", res.status === 400, `status=${res.status}`);


  // ---------- 7. 详情页 ----------
  console.log("\n7) 详情页渲染");
  res = await fetch(`${BASE}/note/${id}`);
  const noteHtml = await res.text();
  check("详情页 200", res.status === 200, `status=${res.status}`);
  for (const kw of ["逐字稿", "会议纪要", "待办清单", "关键词"]) {
    check(`详情页含「${kw}」`, noteHtml.includes(kw));
  }
  check("详情页含逐字稿正文", noteHtml.includes((final?.transcript ?? "___").slice(0, 12)));

  res = await fetch(`${BASE}/processing/${id}`);
  check("处理页 200", res.status === 200, `status=${res.status}`);

  res = await fetch(`${BASE}/note/not-exist-id`);
  const nfHtml = await res.text();
  check("不存在的 id → 友好提示而非崩溃", nfHtml.includes("记录不存在"), `status=${res.status}`);

  // ---------- 8. 改标题 ----------
  console.log("\n8) 标题更新");
  res = await fetch(`${BASE}/api/recordings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "季度复盘会" }),
  });
  data = await json(res);
  check("PATCH 正常标题 → 200", res.status === 200 && data?.title === "季度复盘会", `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "   " }),
  });
  check("PATCH 空白标题 → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(120) }),
  });
  check("PATCH 超长标题 → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings/not-exist-id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "abc" }),
  });
  check("PATCH 不存在的 id → 404", res.status === 404, `status=${res.status}`);

  // ---------- 9. 列表回读 ----------
  console.log("\n9) 列表回读");
  res = await fetch(`${BASE}/api/recordings`);
  data = await json(res);
  const item = data?.items?.find((i) => i.id === id);
  check("新记录出现在列表", !!item);
  check("列表不含完整逐字稿（字段裁剪）", item && !("transcript" in item), Object.keys(item ?? {}).join(","));
  check("列表摘要可作为预览", (item?.summary?.length ?? 0) > 0);

  // ---------- 10. 删除 ----------
  console.log("\n10) 删除");
  res = await fetch(`${BASE}/api/recordings/${id}`, { method: "DELETE" });
  check("DELETE → 200", res.status === 200, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings/${id}`);
  check("删除后 GET → 404", res.status === 404, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings/${id}`, { method: "DELETE" });
  check("重复删除 → 404", res.status === 404, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings`);
  data = await json(res);
  check("删除后列表不再包含", !data?.items?.some((i) => i.id === id));

  // ---------- 11. 搜索 / 筛选 / 排序 ----------
  console.log("\n11) 搜索与筛选");
  const ids = [];
  for (const [title, duration] of [["搜索测试甲", 20], ["搜索测试乙", 70]]) {
    const created = await json(
      await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(duration) }),
    );
    ids.push(created.id);
    await fetch(`${BASE}/api/recordings/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  data = await json(await fetch(`${BASE}/api/recordings?q=${encodeURIComponent("搜索测试甲")}`));
  check(
    "关键词命中只有 1 条",
    data?.total === 1 && data.items[0].title === "搜索测试甲",
    `total=${data?.total}`,
  );

  data = await json(await fetch(`${BASE}/api/recordings?q=${encodeURIComponent("绝不存在的词zzz")}`));
  check("关键词无命中 → 0 条", data?.total === 0, `total=${data?.total}`);

  data = await json(await fetch(`${BASE}/api/recordings?status=error`));
  check(
    "status=error 只返回失败记录",
    Array.isArray(data?.items) && data.items.every((i) => i.status === "error"),
    `total=${data?.total}`,
  );

  data = await json(await fetch(`${BASE}/api/recordings?status=processing`));
  check(
    "status=processing 不混入已完成",
    Array.isArray(data?.items) && data.items.every((i) => i.status !== "done"),
    `total=${data?.total}`,
  );

  data = await json(await fetch(`${BASE}/api/recordings?sort=long`));
  const durations = data?.items?.map((i) => i.duration) ?? [];
  check(
    "sort=long 按时长降序",
    durations.every((d, i) => i === 0 || durations[i - 1] >= d),
    durations.slice(0, 5).join(","),
  );

  // ---------- 12. 批量删除 ----------
  console.log("\n12) 批量删除");
  res = await fetch(`${BASE}/api/recordings`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [] }),
  });
  check("空 ids → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/recordings`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });
  check("非法 body → 400", res.status === 400, `status=${res.status}`);

  data = await json(
    await fetch(`${BASE}/api/recordings`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...ids, "not-exist-id"] }),
    }),
  );
  check("批量删除忽略不存在的 id", data?.deleted === 2, `deleted=${data?.deleted}`);

  data = await json(await fetch(`${BASE}/api/recordings?q=${encodeURIComponent("搜索测试")}`));
  check("批量删除后搜不到", data?.total === 0, `total=${data?.total}`);

  // ---------- 13. 导出 ----------
  console.log("\n13) 导出备份");
  res = await fetch(`${BASE}/api/export?format=json`);
  const exported = await json(res);
  check(
    "JSON 导出结构完整",
    res.status === 200 && exported?.version === 1 && Array.isArray(exported?.recordings),
    `count=${exported?.count}`,
  );
  check(
    "JSON 导出带附件头",
    (res.headers.get("content-disposition") ?? "").includes("attachment"),
  );

  res = await fetch(`${BASE}/api/export?format=md`);
  const mdText = await res.text();
  check(
    "Markdown 导出可读",
    res.status === 200 && mdText.includes("# EchoNote 笔记导出"),
    `${mdText.length} 字`,
  );
  check(
    "Markdown 导出带目录",
    mdText.includes("## 目录"),
  );

  // ---------- 14. 音频回放 ----------
  console.log("\n14) 音频回放（支持 Range）");
  const audioRec = await json(
    await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(37, true, 4096) }),
  );
  const audioId = audioRec?.id;
  check("创建可回放记录", Boolean(audioId), `id=${audioId}`);

  let ar = await fetch(`${BASE}/api/recordings/${audioId}/audio`);
  const fullBytes = (await ar.arrayBuffer()).byteLength;
  check("整段回放 200", ar.status === 200, `status=${ar.status}`);
  check("整段长度与上传一致", fullBytes === 4096, `bytes=${fullBytes}`);
  check("返回音频类型", (ar.headers.get("content-type") ?? "").includes("audio"), ar.headers.get("content-type"));
  check("声明支持 Range", ar.headers.get("accept-ranges") === "bytes");

  ar = await fetch(`${BASE}/api/recordings/${audioId}/audio`, { headers: { Range: "bytes=0-99" } });
  check("Range 请求 206", ar.status === 206, `status=${ar.status}`);
  check(
    "Content-Range 正确",
    ar.headers.get("content-range") === "bytes 0-99/4096",
    ar.headers.get("content-range"),
  );
  check("只返回 100 字节", (await ar.arrayBuffer()).byteLength === 100);

  ar = await fetch(`${BASE}/api/recordings/${audioId}/audio`, { headers: { Range: "bytes=-50" } });
  const tailBytes = (await ar.arrayBuffer()).byteLength;
  check("尾部 Range 生效", ar.status === 206 && tailBytes === 50, `status=${ar.status} bytes=${tailBytes}`);

  ar = await fetch(`${BASE}/api/recordings/${audioId}/audio`, { headers: { Range: "bytes=99999-" } });
  check("越界 Range 返回 416", ar.status === 416, `status=${ar.status}`);

  ar = await fetch(`${BASE}/api/recordings/${audioId}/audio`, { headers: { Range: "nonsense" } });
  check("非法 Range 退回整段", ar.status === 200, `status=${ar.status}`);

  ar = await fetch(`${BASE}/api/recordings/not-a-real-id/audio`);
  check("无音频记录 404", ar.status === 404, `status=${ar.status}`);

  // ---------- 15. 正文可编辑 ----------
  console.log("\n15) 正文可编辑");
  const patch = (payload) =>
    fetch(`${BASE}/api/recordings/${audioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  let ed = await json(await patch({ tags: ["元信息"] }));
  check("只改标签不算改正文", ed?.edited === false, `edited=${ed?.edited}`);

  ed = await json(await patch({ transcript: "手动改过的逐字稿" }));
  check("可改逐字稿", ed?.transcript === "手动改过的逐字稿", String(ed?.transcript).slice(0, 20));
  check("标记为手动编辑", ed?.edited === true, `edited=${ed?.edited}`);

  ed = await json(
    await patch({ summary: "手动摘要", todos: ["待办一", "待办二"], keyPoints: ["关键词A"] }),
  );
  check("可改摘要", ed?.summary === "手动摘要", String(ed?.summary).slice(0, 20));
  check("可改待办", JSON.stringify(ed?.todos) === JSON.stringify(["待办一", "待办二"]), JSON.stringify(ed?.todos));
  check("可改关键词", JSON.stringify(ed?.keyPoints) === JSON.stringify(["关键词A"]), JSON.stringify(ed?.keyPoints));

  res = await patch({ title: "" });
  check("空标题 → 400", res.status === 400, `status=${res.status}`);
  res = await patch({});
  check("空 body → 400", res.status === 400, `status=${res.status}`);
  res = await patch({ title: "x".repeat(101) });
  check("超长标题 → 400", res.status === 400, `status=${res.status}`);
  res = await patch({ keyPoints: "不是数组" });
  check("关键词非数组 → 400", res.status === 400, `status=${res.status}`);

  ed = await json(await patch({ tags: ["工作", "工作", " 会议 ", ""] }));
  check("标签去重去空", JSON.stringify(ed?.tags) === JSON.stringify(["工作", "会议"]), JSON.stringify(ed?.tags));

  ed = await json(
    await patch({ tags: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12", "t13"] }),
  );
  check("标签最多 12 个", ed?.tags?.length === 12, `len=${ed?.tags?.length}`);

  // ---------- 16. 待办勾选与编辑共存 ----------
  console.log("\n16) 待办勾选与编辑共存");
  await fetch(`${BASE}/api/recordings/${audioId}/todos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: [0, 1] }),
  });
  ed = await json(await patch({ todos: ["只剩一条"] }));
  check("编辑待办后勾选被裁剪", JSON.stringify(ed?.todosDone) === JSON.stringify([0]), JSON.stringify(ed?.todosDone));

  // ---------- 17. 只重跑摘要 ----------
  console.log("\n17) 只重跑摘要（不重新转写）");
  res = await fetch(`${BASE}/api/recordings/${audioId}/process?stage=summary`, { method: "POST" });
  check("stage=summary 返回 202", res.status === 202, `status=${res.status}`);

  let afterSummary = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const d = await json(await fetch(`${BASE}/api/recordings/${audioId}`));
    if (d?.status === "done" || d?.status === "error") {
      afterSummary = d;
      break;
    }
  }
  check("只跑摘要能完成", afterSummary?.status === "done", `status=${afterSummary?.status}`);
  check(
    "逐字稿没有被改回去",
    afterSummary?.transcript === "手动改过的逐字稿",
    String(afterSummary?.transcript).slice(0, 20),
  );
  check("摘要确实被重新生成", afterSummary?.summary !== "", String(afterSummary?.summary).slice(0, 20));

  // 没有逐字稿时应该明确拒绝，而不是等一个必然失败的任务
  const bareRec = await json(
    await fetch(`${BASE}/api/recordings`, { method: "POST", body: createForm(9) }),
  );
  res = await fetch(`${BASE}/api/recordings/${bareRec.id}/process?stage=summary`, { method: "POST" });
  check("无逐字稿时 stage=summary → 400", res.status === 400, `status=${res.status}`);
  await fetch(`${BASE}/api/recordings/${bareRec.id}`, { method: "DELETE" });

  // ---------- 18. 只读分享 ----------
  console.log("\n18) 只读分享");
  let share = await json(await fetch(`${BASE}/api/recordings/${audioId}/share`, { method: "POST" }));
  check("生成分享令牌", typeof share?.token === "string" && share.token.length === 32, String(share?.token));

  res = await fetch(`${BASE}/s/${share.token}`);
  const shareHtml = await res.text();
  check("分享页可访问", res.status === 200, `status=${res.status}`);
  check("分享页有内容", shareHtml.includes("只读分享"), `len=${shareHtml.length}`);
  check(
    "分享页没有编辑/删除入口",
    !shareHtml.includes('aria-label="删除') &&
      !shareHtml.includes('aria-label="编辑') &&
      !shareHtml.includes("确认删除"),
  );

  share = await json(
    await fetch(`${BASE}/api/recordings/${audioId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }),
  );
  check("关闭分享后令牌为空", share?.token === null, String(share?.token));

  res = await fetch(`${BASE}/s/${share?.token ?? "deadbeef"}`);
  check("旧链接提示已失效", (await res.text()).includes("已经失效"));

  res = await fetch(`${BASE}/s/0123456789abcdef0123456789abcdef`);
  check("不存在的令牌也不崩", res.status === 200, `status=${res.status}`);

  // ---------- 19. 标签筛选 ----------
  console.log("\n19) 标签筛选");
  await fetch(`${BASE}/api/recordings/${audioId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: ["周会", "产品"] }),
  });

  res = await fetch(`${BASE}/?tag=${encodeURIComponent("周会")}`);
  const tagHtml = await res.text();
  check("按标签访问 200", res.status === 200, `status=${res.status}`);
  check(
    "页面显示标签筛选条件",
    tagHtml.includes("标签：") && tagHtml.includes("周会") && tagHtml.includes("筛选出"),
  );

  res = await fetch(`${BASE}/?tag=${encodeURIComponent("根本不存在的标签")}`);
  check("无命中显示空结果", (await res.text()).includes("没有匹配的记录"));

  const tagApi = await json(await fetch(`${BASE}/api/recordings?tag=${encodeURIComponent("产品")}`));
  check("接口按标签筛选生效", tagApi?.total >= 1, `total=${tagApi?.total}`);

  const noTagApi = await json(await fetch(`${BASE}/api/recordings?tag=${encodeURIComponent("产品x")}`));
  check("标签精确匹配不误伤", noTagApi?.total === 0, `total=${noTagApi?.total}`);

  // ---------- 20. 导入恢复 ----------
  console.log("\n20) 导入恢复");
  const backup = await json(await fetch(`${BASE}/api/export?format=json`));
  check("导出包含标签字段", Array.isArray(backup?.recordings?.[0]?.tags));
  check(
    "导出包含手动编辑标记",
    typeof backup?.recordings?.[0]?.edited === "boolean",
    String(backup?.recordings?.[0]?.edited),
  );

  let imported = await json(
    await fetch(`${BASE}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    }),
  );
  check("导入同名 id 记为更新", imported?.updated === backup?.count, JSON.stringify(imported));

  imported = await json(
    await fetch(`${BASE}/api/import?mode=skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    }),
  );
  check("skip 模式不覆盖", imported?.skipped === backup?.count, JSON.stringify(imported));

  const importId = `import-${Date.now()}`;
  imported = await json(
    await fetch(`${BASE}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordings: [
          {
            id: importId,
            title: "导入的笔记",
            duration: 12,
            transcript: "导入的逐字稿",
            summary: "导入的摘要",
            todos: ["导入待办"],
            keyPoints: ["导入"],
            tags: ["备份"],
            edited: true,
            status: "transcribing",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    }),
  );
  check("新增导入成功", imported?.created === 1, JSON.stringify(imported));

  const importedDoc = await json(await fetch(`${BASE}/api/recordings/${importId}`));
  check("导入内容完整", importedDoc?.transcript === "导入的逐字稿" && importedDoc?.summary === "导入的摘要");
  check("导入标签保留", JSON.stringify(importedDoc?.tags) === JSON.stringify(["备份"]));
  check("导入手动编辑标记保留", importedDoc?.edited === true, `edited=${importedDoc?.edited}`);
  check(
    "导入的「处理中」不会永远转圈",
    importedDoc?.status === "error",
    `status=${importedDoc?.status}`,
  );

  res = await fetch(`${BASE}/api/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: 1 }),
  });
  check("非备份文件 → 400", res.status === 400, `status=${res.status}`);
  res = await fetch(`${BASE}/api/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
  check("非法 JSON → 400", res.status === 400, `status=${res.status}`);

  res = await fetch(`${BASE}/api/export?format=md`);
  check("Markdown 导出带标签行", (await res.text()).includes("- 标签："));

  // ---------- 21. 音频文件与记录同生共死 ----------
  console.log("\n21) 音频文件随记录清理");
  const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
  if (isLocal) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const audioDir = path.join(process.cwd(), "data", "audio");
    const filesOf = (id) =>
      fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter((f) => f.startsWith(`${id}.`)) : [];

    check("上传后音频确实落盘", filesOf(audioId).length >= 2, filesOf(audioId).join(","));

    // 孤儿：磁盘上有、库里没有。正常删除不该留下，历史残留可以在这个入口清掉
    const before = await json(await fetch(`${BASE}/api/maintenance`));
    check("能统计孤儿音频", typeof before?.orphan?.count === "number", JSON.stringify(before?.orphan));

    // 删除失败会在后台补删（Windows 句柄残留），所以断言按「最终一致」轮询
    const waitGone = async (id, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (filesOf(id).length === 0) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return filesOf(id).length === 0;
    };
    const waitOrphanZero = async (ms = 3000) => {
      const deadline = Date.now() + ms;
      let last = null;
      while (Date.now() < deadline) {
        last = await json(await fetch(`${BASE}/api/maintenance`));
        if (last?.orphan?.count === 0) return last;
        await new Promise((r) => setTimeout(r, 100));
      }
      return last;
    };

    await fetch(`${BASE}/api/recordings`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [audioId, importId] }),
    });
    await new Promise((r) => setTimeout(r, 200));
    check("删除记录后音频文件一起消失", await waitGone(audioId), filesOf(audioId).join(","));
    check("批量删除也清了音频", await waitGone(importId), filesOf(importId).join(","));

    const pruned = await json(
      await fetch(`${BASE}/api/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prune-audio" }),
      }),
    );
    check("清理孤儿接口可用", pruned?.ok === true, JSON.stringify(pruned));

    const after = await waitOrphanZero();
    check("清理后没有孤儿", after?.orphan?.count === 0, JSON.stringify(after?.orphan));

    const badAction = await fetch(`${BASE}/api/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drop-database" }),
    });
    check("不认识的操作被拒", badAction.status === 400, `status=${badAction.status}`);
  } else {
    await fetch(`${BASE}/api/recordings`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [audioId, importId] }),
    });
  }
  await fetch(`${BASE}/api/recordings/${importId}`, { method: "DELETE" });

  finish();
}

function finish() {
  const restored = restoreKeys();
  if (restored > 0) console.log(`\x1b[90m（已恢复 ${restored} 项 API Key 设置）\x1b[0m`);
  console.log(`\n\x1b[1m结果：\x1b[0m\x1b[32m${pass} 通过\x1b[0m，${fail ? `\x1b[31m${fail} 失败\x1b[0m` : "0 失败"}\n`);
  if (fail) {
    console.log("失败项：");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n脚本异常：", err);
  process.exitCode = 1;
});
