/**
 * 浏览器 UI 验收（真实 Chrome，无头）
 * 用法：node scripts/ui-check.mjs [baseURL]
 *
 * 覆盖：375px 无横向滚动、控制台报错、删除弹窗居中且可点、待办勾选联动、
 *      卡片→详情跳转、导出按钮存在、截图留档（shots/）
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { enterMockMode, restoreKeys } from "./test-mode.mjs";
import { installAuthFetch, loginCookie } from "./access-client.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = "shots";

let pass = 0;
let fail = 0;
const failures = [];

const ok = (n, e = "") => {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${n}${e ? ` \x1b[90m${e}\x1b[0m` : ""}`);
};
const bad = (n, d) => {
  fail++;
  failures.push(`${n} :: ${d}`);
  console.log(`  \x1b[31m✗\x1b[0m ${n} \x1b[31m${d}\x1b[0m`);
};
const check = (n, cond, d = "") => {
  cond ? ok(n, d) : bad(n, d || "断言失败");
  return cond;
};

const noOverflow = () =>
  document.documentElement.scrollWidth <= window.innerWidth + 1;

async function createRecord(duration = 96) {
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(2048)], { type: "audio/webm" }), "a.webm");
  fd.append("duration", String(duration));
  const res = await fetch(`${BASE}/api/recordings`, { method: "POST", body: fd });
  const { id } = await res.json();
  await fetch(`${BASE}/api/recordings/${id}/process`, { method: "POST" });
  // 等处理完成
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const d = await (await fetch(`${BASE}/api/recordings/${id}`)).json();
    if (d.status === "done") return id;
    if (d.status === "error") throw new Error("处理失败：" + d.error);
  }
  throw new Error("处理超时");
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`\n\x1b[1m浏览器 UI 验收 → ${BASE}\x1b[0m\n`);

  // 虚拟麦克风合成的是正弦音，真实识别接口拿不到有意义的文本；
  // 临时停用真实 Key 让 pipeline 走 Mock，结束时自动还原。
  const disabled = enterMockMode();
  if (disabled > 0) {
    console.log(`\x1b[90m（检测到已配置真实 Key，验收期间临时停用 ${disabled} 项，改用 Mock）\x1b[0m\n`);
    await new Promise((r) => setTimeout(r, 2600));
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // 虚拟麦克风，用于验证真实录音链路
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const page = await browser.newPage();

  // 开了访问口令时先拿一张 cookie：Node 侧的接口调用和浏览器都要用，
  // 否则每一条 goto 都会被重定向到 /login，断言全部对不上。
  try {
    const cookie = await loginCookie(BASE);
    if (cookie) {
      installAuthFetch(BASE, cookie);
      const eq = cookie.indexOf("=");
      const name = cookie.slice(0, eq);
      const value = cookie.slice(eq + 1);
      const host = new URL(BASE).hostname;
      await page.setCookie({ name, value, domain: host, path: "/", httpOnly: true });
      console.log("\x1b[90m（服务已开启访问口令，验收已自动登录）\x1b[0m\n");
    }
  } catch (err) {
    console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : err}\x1b[0m`);
    console.error("  .env 里的 ACCESS_PASSWORD 和正在运行的服务对不上？改完记得重启服务。\n");
    await browser.close();
    process.exit(1);
  }

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  // ---------- 1. 移动端 375px ----------
  console.log("1) 移动端 375×812");
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  check("首页无横向滚动", await page.evaluate(noOverflow));
  {
    const text = await page.evaluate(() => document.body.innerText);
    const empty = text.includes("还没有录音");
    const listed = /共\s*\d+\s*条录音/.test(text);
    check("首页显示空状态或列表", empty || listed, empty ? "空状态" : "有记录");
  }
  await page.screenshot({ path: path.join(SHOTS, "m-home-empty.png"), fullPage: true });

  await page.goto(BASE + "/record", { waitUntil: "networkidle0" });
  check("录音页无横向滚动", await page.evaluate(noOverflow));
  const micBox = await page.evaluate(() => {
    const b = document.querySelector('[aria-label="开始录音"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check("录音按钮尺寸 ≥80px", !!micBox && micBox.w >= 80 && micBox.h >= 80, JSON.stringify(micBox));
  await page.screenshot({ path: path.join(SHOTS, "m-record.png"), fullPage: true });

  // ---------- 2. 详情页 ----------
  console.log("\n2) 详情页（375px）");
  const id = await createRecord();
  await page.goto(`${BASE}/note/${id}`, { waitUntil: "networkidle0" });
  check("详情页无横向滚动", await page.evaluate(noOverflow));
  check("移动端「会议纪要」在「逐字稿」上方", await page.evaluate(() => {
    const h2 = [...document.querySelectorAll("h2")];
    const summary = h2.find((h) => h.textContent.includes("会议纪要"));
    const transcript = h2.find((h) => h.textContent.includes("逐字稿"));
    if (!summary || !transcript) return false;
    return summary.getBoundingClientRect().top < transcript.getBoundingClientRect().top;
  }));

  // 待办勾选联动
  const todoBtns = await page.$$('button[type="button"]');
  let todoClicked = false;
  for (const btn of todoBtns) {
    const text = await page.evaluate((el) => el.textContent || "", btn);
    if (text.includes("风控") || text.includes("埋点")) {
      await btn.click();
      todoClicked = true;
      break;
    }
  }
  check("待办项可勾选", todoClicked);
  await new Promise((r) => setTimeout(r, 900));
  const progress = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((el) => /\d+\s*\/\s*\d+\s*项/.test(el.textContent || ""));
    return p ? p.textContent.trim() : null;
  });
  check("勾选后进度数字联动（1 / 6 项）", /^1\s*\/\s*6\s*项/.test(progress || ""), progress || "未找到进度元素");

  // 刷新后勾选状态仍在（验证写库）
  const noteUrl = page.url();
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  const stillChecked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /风控|埋点/.test(b.textContent || ""));
    return btn ? btn.getAttribute("aria-pressed") === "true" : null;
  });
  check("刷新后勾选状态保持", stillChecked === true, String(stillChecked));
  check("刷新后仍是同一条记录", page.url() === noteUrl);
  await page.screenshot({ path: path.join(SHOTS, "m-note.png"), fullPage: true });

  // ---------- 3. 删除确认弹窗 ----------
  console.log("\n3) 删除确认弹窗（375px）");
  const deleteBtn = await page.$$("button");
  let opened = false;
  for (const b of deleteBtn) {
    const t = await page.evaluate((el) => el.textContent || "", b);
    if (t.trim() === "删除") {
      await b.click();
      opened = true;
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="alertdialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    // 找到最外层浮层容器，看它是不是挂在 body 上（否则会被祖先 transform 影响定位）
    let root = d;
    while (root.parentElement && root.parentElement !== document.body) {
      root = root.parentElement;
    }
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      vw: window.innerWidth,
      vh: window.innerHeight,
      parentIsBody: root.parentElement === document.body,
    };
  });
  check("点击删除后弹窗出现", !!dialog && opened);
  check("弹窗挂载到 body（不被卡片 transform 影响）", dialog?.parentIsBody === true, JSON.stringify(dialog));
  check(
    "弹窗在视口内且居中",
    !!dialog && dialog.left >= 0 && dialog.right <= dialog.vw && Math.abs((dialog.left + dialog.right) / 2 - dialog.vw / 2) < 6,
    JSON.stringify(dialog),
  );
  await page.screenshot({ path: path.join(SHOTS, "m-dialog.png") });

  // 取消
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="alertdialog"] button')];
    const cancel = btns.find((b) => b.textContent.trim() === "取消");
    cancel?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  check("取消后弹窗关闭", await page.evaluate(() => !document.querySelector('[role="alertdialog"]')));

  // ---------- 4. 首页卡片 ----------
  console.log("\n4) 首页卡片（移动端）");
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  check("卡片渲染", (await page.content()).includes("未命名录音"));
  check("首页无横向滚动", await page.evaluate(noOverflow));
  const deleteVisible = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label="删除这条录音"]')];
    if (!btns.length) return false;
    return getComputedStyle(btns[0]).opacity !== "0";
  });
  check("移动端删除按钮可见（不依赖 hover）", deleteVisible);
  await page.screenshot({ path: path.join(SHOTS, "m-home-list.png"), fullPage: true });

  // ---------- 4.5 搜索与批量选择 ----------
  console.log("\n4.5) 搜索与批量选择（移动端）");
  const countCards = () => page.$$eval("[data-recording-id]", (els) => els.length);

  check("工具栏不撑破 375px", await page.evaluate(noOverflow));

  // 给"本次验收自己创建的那条"打一个独一无二的标题，用来验证搜索收敛。
  // 注意不要拿列表里任意一张卡片去打标——那可能是使用者自己的真实记录，
  // 改了不还原等于弄脏数据。
  const markTitle = "唯一标题ZQ7";
  await page.evaluate(
    async ({ id, title }) => {
      await fetch(`/api/recordings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    },
    { id, title: markTitle },
  );
  await page.reload({ waitUntil: "networkidle0" });

  const totalCards = await countCards();
  check("有卡片可供操作", totalCards > 0, `cards=${totalCards}`);

  await page.type('input[aria-label="搜索录音"]', "ZQ7");
  await new Promise((r) => setTimeout(r, 1000));
  const keptCount = await countCards();
  const keptTitles = await page.$$eval("[data-recording-id] h3", (els) =>
    els.map((e) => (e.textContent ?? "").trim()),
  );
  check("唯一关键词只命中 1 条", keptCount === 1, `${totalCards} → ${keptCount}`);
  check(
    "命中的就是被打标的那条",
    keptTitles.length === 1 && keptTitles[0] === markTitle,
    keptTitles.join(" | "),
  );
  check("URL 写入 q 参数", (await page.evaluate(() => location.search)).includes("q="));

  await page.click('button[aria-label="清空搜索"]');
  await new Promise((r) => setTimeout(r, 700));
  await page.type('input[aria-label="搜索录音"]', "ZZZ不存在");
  await new Promise((r) => setTimeout(r, 1000));
  check(
    "无命中时显示空结果提示",
    (await page.content()).includes("没有匹配的记录"),
    `cards=${await countCards()}`,
  );

  await page.click('button[aria-label="清空搜索"]');
  await new Promise((r) => setTimeout(r, 1000));
  check("清空搜索后恢复全部", (await countCards()) === totalCards, `cards=${await countCards()}`);

  const tapBtn = async (txt) => {
    await page.evaluate((t) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").trim().includes(t),
      );
      btn?.click();
    }, txt);
    await new Promise((r) => setTimeout(r, 350));
  };

  await tapBtn("批量选择");
  const pressedAttr = await page.$eval("[data-recording-id] a", (el) => el.getAttribute("aria-pressed"));
  check("进入选择模式（aria-pressed 出现）", pressedAttr === "false", `attr=${pressedAttr}`);

  await page.click("[data-recording-id] a");
  await new Promise((r) => setTimeout(r, 350));
  check("选择模式下点卡片不跳转", (await page.evaluate(() => location.pathname)) === "/");
  const picked = await page.$$eval('[data-recording-id] a[aria-pressed="true"]', (els) => els.length);
  check("点卡片即勾选", picked === 1, `selected=${picked}`);

  // 只有 1 张卡片时，点一张就已经"全选"，按钮会变成"取消全选"，不能再点
  const allBtnText = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /全选/.test(x.textContent ?? ""));
    return (b?.textContent ?? "").trim();
  });
  if (allBtnText === "全选") await tapBtn("全选");
  const pickedAll = await page.$$eval('[data-recording-id] a[aria-pressed="true"]', (els) => els.length);
  check("全选选中全部卡片", pickedAll === totalCards, `selected=${pickedAll}/${totalCards}`);

  const delText = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /删除\s*\d/.test((b.textContent ?? "").trim()),
    );
    return (btn?.textContent ?? "").trim();
  });
  check("删除按钮带选中数量", /删除\s*\d+/.test(delText), delText || "未找到");
  await page.screenshot({ path: path.join(SHOTS, "m-home-select.png"), fullPage: true });

  await tapBtn("退出");
  check(
    "退出后回到普通模式",
    await page.evaluate(() => document.querySelector("[data-recording-id] a[aria-pressed]") === null),
  );


  // ---------- 5. 桌面端 ----------
  console.log("\n5) 桌面端 1280×900");
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  const cols = await page.evaluate(() => {
    const grid = document.querySelector("section > div.grid");
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });
  check("桌面端卡片 3 列", cols === 3, `cols=${cols}`);
  await page.screenshot({ path: path.join(SHOTS, "d-home.png"), fullPage: true });

  await page.goto(`${BASE}/note/${id}`, { waitUntil: "networkidle0" });
  const twoCol = await page.evaluate(() => {
    const grid = document.querySelector("div.grid.grid-cols-1");
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });
  check("桌面端详情两栏", twoCol === 2, `cols=${twoCol}`);
  await page.screenshot({ path: path.join(SHOTS, "d-note.png"), fullPage: true });

  // ---------- 6. 卡片 → 详情 ----------
  console.log("\n6) 卡片点击跳转");
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await page.click('a[aria-label^="打开"]');
  await page.waitForFunction(() => location.pathname.startsWith("/note/"), { timeout: 8000 }).catch(() => {});
  check("点击卡片进入详情页", (await page.evaluate(() => location.pathname)).startsWith("/note/"));

  // ---------- 7. 真实录音链路 ----------
  console.log("\n7) 真实录音（虚拟麦克风）");
  await browser.defaultBrowserContext().overridePermissions(BASE, ["microphone"]);
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.goto(BASE + "/record", { waitUntil: "networkidle0" });
  await page.click('[aria-label="开始录音"]');
  await new Promise((r) => setTimeout(r, 2600));
  const timerText = await page.evaluate(() => document.body.innerText);
  check("录音中显示计时", /00:0[12]/.test(timerText), (timerText.match(/00:\d\d/) || [])[0] || "无计时");
  await page.screenshot({ path: path.join(SHOTS, "m-recording.png") });

  await page.click('[aria-label="停止录音"]');
  const reachedProcessing = await page
    .waitForFunction(() => location.pathname.startsWith("/processing/"), { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  check("停止后跳转处理页", reachedProcessing, await page.evaluate(() => location.pathname));
  await page.screenshot({ path: path.join(SHOTS, "m-processing.png") });

  const reachedNote = await page
    .waitForFunction(() => location.pathname.startsWith("/note/"), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("处理完成后自动跳详情页", reachedNote, await page.evaluate(() => location.pathname));

  const recId = await page.evaluate(() => location.pathname.split("/").pop());
  const rec = await (await fetch(`${BASE}/api/recordings/${recId}`)).json();
  check("真实录音时长已记录（≈2-3 秒）", rec.duration >= 1 && rec.duration <= 5, `duration=${rec.duration}`);
  check("真实录音已生成逐字稿", (rec.transcript || "").length > 100, `${(rec.transcript || "").length} 字`);
  check("真实录音已生成纪要", (rec.summary || "").length > 20);
  await fetch(`${BASE}/api/recordings/${recId}`, { method: "DELETE" });

  // ---------- 8. 改标题 ----------
  console.log("\n8) 改标题（真实交互）");
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/note/${id}`, { waitUntil: "networkidle0" });
  await page.click('button[aria-label="编辑标题"]');
  const inputSel = 'input[type="text"], input:not([type])';
  await page.waitForSelector(inputSel, { timeout: 3000 });
  await page.evaluate(() => {
    const input = document.querySelector("input");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(inputSel, "季度复盘会（改）");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 1200));
  const afterEdit = await (await fetch(`${BASE}/api/recordings/${id}`)).json();
  check("回车保存后服务端标题已更新", afterEdit.title === "季度复盘会（改）", afterEdit.title);
  check("页面标题同步刷新", (await page.content()).includes("季度复盘会（改）"));

  // ---------- 9. 导出 Markdown / Word ----------
  console.log("\n9) 导出 Markdown / Word");
  const dlDir = path.resolve(SHOTS, "downloads");
  fs.rmSync(dlDir, { recursive: true, force: true });
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  /** 点「导出」打开菜单，再点里面的某一项 */
  const clickExportItem = async (label) => {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent || "").trim().startsWith("导出"),
      );
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    const opened = await page.$$eval('[role="menuitem"]', (els) => els.length);
    check("点「导出」弹出菜单", opened === 2, `菜单项 ${opened} 个`);
    await page.evaluate((text) => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
        (b.textContent || "").includes(text),
      );
      item?.click();
    }, label);
  };

  const waitFile = async (ext) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const files = fs.readdirSync(dlDir).filter((f) => f.endsWith(ext));
      if (files.length) return path.join(dlDir, files[0]);
    }
    return null;
  };

  await clickExportItem("Markdown");
  const file = await waitFile(".md");
  check("点击后确实下载了 .md 文件", !!file, file || "未生成文件");
  if (file) {
    const md = fs.readFileSync(file, "utf8");
    check("Markdown 含标题/摘要/待办/关键词/逐字稿", ["# 季度复盘会（改）", "## 摘要", "## 待办", "## 关键词", "## 逐字稿"].every((k) => md.includes(k)));
    check("文件名已过滤非法字符", !/[\\/:*?"<>|]/.test(path.basename(file)), path.basename(file));
  }

  await clickExportItem("Word");
  const docx = await waitFile(".docx");
  check("点击后确实下载了 .docx 文件", !!docx, docx || "未生成文件");
  if (docx) {
    const buf = fs.readFileSync(docx);
    // docx 是 zip，头两字节必须是 PK
    check("docx 是真正的压缩包（PK 头）", buf[0] === 0x50 && buf[1] === 0x4b, `头部 ${buf.slice(0, 2).toString("hex")}`);
    check("docx 体积合理（>5KB）", buf.length > 5000, `${buf.length} 字节`);
  }

  // ---------- 10. 卡片删除 ----------
  console.log("\n10) 卡片删除（确认后真正消失）");
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  // 列表有交错弹入动画，动画没结束就点，坐标会算在动画中间的位置而点空
  await new Promise((r) => setTimeout(r, 800));
  const before = await page.$$eval('a[aria-label^="打开"]', (els) => els.length);
  const trash = await page.$('button[aria-label="删除这条录音"]');
  check("首页有删除按钮", !!trash);
  const trashBox = await page.$eval('button[aria-label="删除这条录音"]', (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("删除按钮触控尺寸 ≥44px", trashBox.w >= 44 && trashBox.h >= 44, `${trashBox.w}×${trashBox.h}`);
  if (trash) {
    await trash.click();
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="alertdialog"] button')].find(
        (b) => (b.textContent || "").includes("确认删除"),
      );
      btn?.click();
    });

    // 生产模式下接口路由首次被访问要现加载，DELETE 可能 2-3 秒才返回，
    // 固定 sleep 会误判成"卡片没消失"，改成轮询等结果
    const t0 = Date.now();
    let after = before;
    for (let i = 0; i < 48; i++) {
      await new Promise((r) => setTimeout(r, 250));
      after = await page.$$eval('a[aria-label^="打开"]', (els) => els.length);
      if (after === before - 1) break;
    }
    check("确认后卡片从列表消失", after === before - 1, `${before} → ${after}（${Date.now() - t0}ms）`);
    const gone = await fetch(`${BASE}/api/recordings/${id}`);
    check("服务端记录已删除（404）", gone.status === 404, `status=${gone.status}`);
  }

  // ---------- 11. 处理没启动时的兜底 ----------
  console.log("\n11) process 请求失败 → 停滞兜底与恢复");
  const fd2 = new FormData();
  fd2.append("audio", new Blob([new Uint8Array(1024)], { type: "audio/webm" }), "b.webm");
  fd2.append("duration", "20");
  const stuck = await (await fetch(`${BASE}/api/recordings`, { method: "POST", body: fd2 })).json();

  await page.setRequestInterception(true);
  const blocker = (req) => {
    if (req.url().includes("/process") && req.method() === "POST") req.abort();
    else req.continue();
  };
  page.on("request", blocker);

  await page.goto(`${BASE}/processing/${stuck.id}`, { waitUntil: "domcontentloaded" });
  const stalledShown = await page
    .waitForFunction(() => document.body.innerText.includes("处理没能启动"), { timeout: 22000 })
    .then(() => true)
    .catch(() => false);
  check("处理一直没启动 → 显示停滞提示而不是无限转圈", stalledShown);

  page.off("request", blocker);
  await page.setRequestInterception(false);
  const retried = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("重试"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("停滞态可以点重试", retried);
  const recovered = await page
    .waitForFunction(() => location.pathname.startsWith("/note/"), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("重试后恢复并进入详情页", recovered, await page.evaluate(() => location.pathname));
  await fetch(`${BASE}/api/recordings/${stuck.id}`, { method: "DELETE" });

  // ---------- 11.5 设置页 ----------
  console.log("\n11.5) 设置页（配置模型不用改文件）");
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.goto(BASE + "/settings", { waitUntil: "networkidle0" });
  check("设置页无横向滚动", await page.evaluate(noOverflow));
  const settingsText = await page.evaluate(() => document.body.innerText);
  check("有语音识别与大模型两组", /语音识别/.test(settingsText) && /大模型/.test(settingsText));
  check("有服务地址 / API Key / 模型三项", /服务地址/.test(settingsText) && /API Key/.test(settingsText) && /模型/.test(settingsText));
  check("有测试连接与保存按钮", /测试连接/.test(settingsText) && /保存设置/.test(settingsText));

  const settingsInputs = await page.$$("input");
  check("输入框可交互", settingsInputs.length >= 6, `inputs=${settingsInputs.length}`);

  // 点预设按钮应把地址填进去
  const presetBtns = await page.$$("button");
  let presetApplied = false;
  for (const b of presetBtns) {
    const t = await page.evaluate((el) => el.textContent || "", b);
    if (t.includes("硅基流动")) {
      await b.click();
      presetApplied = true;
      break;
    }
  }
  if (presetApplied) {
    const firstValue = await page.evaluate(() => document.querySelector("input")?.value ?? "");
    check("预设按钮填入服务地址", firstValue.includes("siliconflow"), firstValue);
  } else {
    check("预设按钮填入服务地址", false, "未找到预设按钮");
  }
  await page.screenshot({ path: path.join(SHOTS, "m-settings.png"), fullPage: true });

  // 孤儿音频清理入口：造一个数据库里不存在的音频文件，看设置页会不会提示并能清掉
  const audioDir = path.join(process.cwd(), "data", "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const orphanFile = path.join(audioDir, "orphan-test-0000.webm");
  fs.writeFileSync(orphanFile, Buffer.alloc(64));

  await page.goto(BASE + "/settings", { waitUntil: "networkidle0" });
  const orphanTip = await page.evaluate(() => document.body.innerText);
  check("设置页提示孤儿音频", orphanTip.includes("没有对应记录的音频文件"), orphanTip.slice(0, 80));

  const clickedClean = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "清理",
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("有清理按钮", clickedClean);
  // 删除失败时 audioStore 会走后台补删（400ms / 2.5s 两轮），所以不能固定等一个时间点
  let orphanGone = false;
  for (let i = 0; i < 25; i++) {
    if (!fs.existsSync(orphanFile)) {
      orphanGone = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  check("点清理后文件真的被删掉", orphanGone, orphanGone ? "已删除" : "5 秒后仍存在");
  if (!orphanGone) fs.rmSync(orphanFile, { force: true });

  // 桌面宽度再截一张
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(BASE + "/settings", { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(SHOTS, "d-settings.png"), fullPage: true });

  // ---------- 11.8 详情页：音频 / 编辑 / 标签 / 分享 ----------
  console.log("\n11.8) 详情页：音频回放、正文编辑、标签、分享");
  const fd3 = new FormData();
  fd3.append("audio", new Blob([new Uint8Array(8192)], { type: "audio/webm" }), "c.webm");
  fd3.append("duration", "30");
  const editRec = await (await fetch(`${BASE}/api/recordings`, { method: "POST", body: fd3 })).json();
  await fetch(`${BASE}/api/recordings/${editRec.id}/process`, { method: "POST" });
  for (let i = 0; i < 70; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const d = await (await fetch(`${BASE}/api/recordings/${editRec.id}`)).json();
    if (d.status === "done" || d.status === "error") break;
  }

  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/note/${editRec.id}`, { waitUntil: "networkidle0" });

  const audioEl = await page.$("audio");
  check("详情页有音频播放器", !!audioEl);
  const audioSrc = audioEl ? await page.$eval("audio", (el) => el.getAttribute("src")) : "";
  check(
    "播放器指向音频接口",
    (audioSrc || "").includes(`/api/recordings/${editRec.id}/audio`),
    audioSrc || "无 src",
  );
  const ranged = await fetch(`${BASE}/api/recordings/${editRec.id}/audio`, {
    headers: { Range: "bytes=0-99" },
  });
  check("音频接口支持分段（iOS 拖动进度条必需）", ranged.status === 206, `status=${ranged.status}`);

  // 编辑摘要
  const openedEdit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") || "").includes("纪要"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("摘要区块有编辑入口", openedEdit);
  if (openedEdit) {
    await page.waitForSelector("textarea", { timeout: 3000 });
    await page.click("textarea");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.type("textarea", "我手写的摘要内容");
    const saved = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "保存",
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    check("有保存按钮", saved);
    await new Promise((r) => setTimeout(r, 1500));
    const afterEditApi = await (await fetch(`${BASE}/api/recordings/${editRec.id}`)).json();
    check("编辑后的摘要已入库", afterEditApi.summary === "我手写的摘要内容", afterEditApi.summary.slice(0, 20));
    check("服务端标记为手动编辑", afterEditApi.edited === true);
    const pageText = await page.evaluate(() => document.body.innerText);
    check("页面出现「已手动编辑」标记", pageText.includes("已手动编辑"));
    check("页面显示改后的摘要", pageText.includes("我手写的摘要内容"));
  }

  // 标签
  await page.click('input[aria-label="添加标签"]');
  await page.type('input[aria-label="添加标签"]', "手动标签");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 1500));
  const tagState = await (await fetch(`${BASE}/api/recordings/${editRec.id}`)).json();
  check("标签已写入", (tagState.tags || []).includes("手动标签"), JSON.stringify(tagState.tags));
  check("页面出现标签 chip", (await page.content()).includes("手动标签"));

  const removedTag = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="删除标签 手动标签"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("标签可以删除", removedTag);
  await new Promise((r) => setTimeout(r, 1200));
  const tagState2 = await (await fetch(`${BASE}/api/recordings/${editRec.id}`)).json();
  check("删除后标签真的没了", !(tagState2.tags || []).includes("手动标签"), JSON.stringify(tagState2.tags));

  // 分享
  const openedShare = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "分享",
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("详情页有分享入口", openedShare);
  await new Promise((r) => setTimeout(r, 900));
  check("分享弹窗打开", (await page.evaluate(() => document.body.innerText)).includes("只读分享"));

  const triggered = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("生成分享链接"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1500));
  const shareState = await (await fetch(`${BASE}/api/recordings/${editRec.id}/share`)).json();
  check("点按钮后真的开启了分享", shareState.shared === true && !!triggered, JSON.stringify(shareState));
  if (shareState.token) {
    const linkValue = await page
      .$eval('input[aria-label="分享链接"]', (el) => el.value)
      .catch(() => "");
    check("弹窗里显示可复制的链接", linkValue.includes(`/s/${shareState.token}`), linkValue || "未找到链接输入框");
    await page.screenshot({ path: path.join(SHOTS, "d-share.png"), fullPage: false });

    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 400));

    const sharedRes = await page.goto(`${BASE}/s/${shareState.token}`, { waitUntil: "networkidle0" });
    check("分享页能打开", sharedRes.status() === 200, `status=${sharedRes.status()}`);
    const sharedText = await page.evaluate(() => document.body.innerText);
    check("分享页展示了笔记内容", sharedText.includes("我手写的摘要内容"));
    const noEdit = await page.evaluate(
      () =>
        !document.querySelector('button[aria-label^="编辑"]') &&
        !document.querySelector('button[aria-label^="删除"]'),
    );
    check("分享页没有任何编辑/删除按钮", noEdit);
    await page.screenshot({ path: path.join(SHOTS, "m-shared.png"), fullPage: true });
  }

  // 移动端：按钮变多 + 播放器，确认没把页面撑破
  await page.goto(`${BASE}/note/${editRec.id}`, { waitUntil: "networkidle0" });
  await page.setViewport({ width: 375, height: 900, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: "networkidle0" });
  check("移动端详情页无横向滚动", await page.evaluate(noOverflow));
  const audioWidth = await page
    .$eval("audio", (el) => Math.round(el.getBoundingClientRect().width))
    .catch(() => 0);
  check("播放器不超出屏宽", audioWidth > 0 && audioWidth <= 375, `${audioWidth}px`);
  const actionCount = await page.$$eval("button", (els) =>
    els.filter((b) => ["重新处理", "只更新摘要", "分享", "导出", "删除"].some((t) => (b.textContent || "").trim().startsWith(t))).length,
  );
  check("操作按钮都在（窄屏会换行）", actionCount >= 4, `buttons=${actionCount}`);
  await page.screenshot({ path: path.join(SHOTS, "m-note-actions.png"), fullPage: true });

  await fetch(`${BASE}/api/recordings/${editRec.id}`, { method: "DELETE" });

  // ---------- 12. 控制台 ----------
  console.log("\n12) 控制台");
  // 第 11 步故意 abort 了 /process 请求，浏览器会留下一条 ERR_FAILED，属于预期
  const meaningful = consoleErrors.filter(
    (e) =>
      !/favicon|Download the React DevTools|net::ERR_FAILED|Failed to load resource: the server responded with a status of 404/i.test(
        e,
      ),
  );
  check("无 JS 报错", meaningful.length === 0, meaningful.slice(0, 3).join(" | "));

  await fetch(`${BASE}/api/recordings/${id}`, { method: "DELETE" }).catch(() => {});
  await browser.close();

  const restored = restoreKeys();
  if (restored > 0) console.log(`\x1b[90m（已恢复 ${restored} 项 API Key 设置）\x1b[0m`);
  console.log(`\n\x1b[1m结果：\x1b[0m\x1b[32m${pass} 通过\x1b[0m，${fail ? `\x1b[31m${fail} 失败\x1b[0m` : "0 失败"}`);
  if (fail) {
    console.log("失败项：");
    failures.forEach((f) => console.log("  - " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\n脚本异常：", e);
  process.exitCode = 1;
});
