# EchoNote · 个人 AI 录音笔记助手

浏览器录音 / 上传音频 → 转写成文字（ASR）→ 大模型生成结构化会议纪要（概要 / 分议题 / 决策 / 行动项，长录音自动分段不截断）→ 存到本地数据库，可回放原音频校对、可手动改、可打标签筛选、可只读分享、可导出 Word/Markdown 与整库备份恢复。

- 纯网页应用，单机使用，**无账号系统、无多用户、无付费**
- 桌面端优先，**完整响应式**，手机浏览器可用；带 PWA 配置，可「添加到主屏幕」全屏使用
- **零 API Key 可体验全流程，但内容不是真实识别**：ASR 与 LLM 均为可替换抽象层，未配置时返回写死的演示语料，并在卡片、录音页、详情页三处显著标注「演示」，避免与真实结果混淆
- **模型配置在应用内完成**：打开 `/settings` 填地址、Key、模型，点「测试连接」可验证鉴权与音频接口，保存后**立即生效、无需重启**

> 面向使用者的完整操作手册见 **[使用文档.md](./使用文档.md)**（录音、处理、导出、接入真实模型、手机使用、常见问题）。本 README 偏开发者视角。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 14（App Router）+ TypeScript |
| 样式 | Tailwind CSS（手写组件，无 UI 库） |
| 数据 | Prisma ORM + SQLite（`prisma/dev.db`） |
| 录音 | 浏览器原生 MediaRecorder API |
| 模型 | OpenAI 兼容协议（fetch 调用） |

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env      # Windows: copy .env.example .env

# 3. 初始化数据库
npx prisma db push

# 4. 启动
npm run dev
# 打开 http://localhost:3000
```

> 首次 `npm install` 会自动执行 `prisma generate`。若手动执行过 `prisma db push` 后仍提示找不到表，重新跑一次 `npx prisma generate` 即可。

### Windows 一键脚本

仓库根目录有两个双击即用的批处理：

| 脚本 | 作用 |
| --- | --- |
| `启动网站.bat` | 起服务（缺依赖会先装、缺构建产物会先构建）、自动开浏览器，并在窗口里打印**手机访问地址 + 二维码** |
| `放行手机访问.bat` | 手机连不上时用。右键 → 以管理员身份运行，执行一次即可（加两条入站放行规则） |

macOS / Linux 用 `npm run serve` 即可，它是同一个启动器（`scripts/serve-https.mjs`）。

**服务是一个进程，同时监听两个端口**：

| 端口 | 协议 | 给谁用 |
| --- | --- | --- |
| 3000 | http | 电脑自己 |
| 3443 | https（自签证书） | 手机。麦克风只在 `https://` 或 `localhost` 下可用，这是浏览器硬限制 |

实测常驻内存约 **90 MB**（boot 看守 + 服务两个进程，含 HTTPS 那一层）。没有后台守护进程、没有定时器。

- 端口已占用时脚本不会重复启动，只打印手机地址并开浏览器。
- 手动启动时服务跑在脚本自己的窗口里，**关掉窗口就停止服务**；开机自启那份没有窗口，在后台跑。
- 开机自启是计划任务 `EchoNote`（当前用户登录时触发，隐藏窗口，日志写 `data/boot.log`）。想取消：任务计划程序 → `EchoNote` → 禁用。
- `boot.mjs` 会看守服务进程：异常退出按 1s/2s/4s/8s 退避重启，10 分钟内连续崩 5 次才放弃；计划任务本身也配了失败重试。
- HTTPS 证书在 `certificates/`（已忽略），由本机 `openssl` 生成，换网络导致 IP 变化时会自动重新生成；找不到 openssl 时只开 3000，不影响电脑使用。

> **改这两个 `.bat` 必须保持 UTF-8（无 BOM）+ CRLF 换行。**
> 脚本第一行是 `chcp 65001`，把 cmd 切到 UTF-8 代码页——因为 Node 输出的中文和二维码都是 UTF-8，若用中文系统默认的 936（GBK）显示会全是乱码。
> 反过来，如果文件存成 GBK 而代码页是 65001，同样会乱；两种情况都可能让 cmd 在错误的字节边界断行，报一堆 `'xxx' 不是内部或外部命令`。
> 用 VS Code 改的话，右下角选 `UTF-8`（不要带 BOM），换行选 `CRLF`，改完别用记事本存。

## 环境变量说明

| 变量 | 说明 | 留空时行为 |
| --- | --- | --- |
| `DATABASE_URL` | SQLite 文件路径，默认 `file:./dev.db` | — |
| `OPENAI_BASE_URL` | OpenAI 兼容服务地址，如 `https://api.openai.com/v1` | 走 Mock 纪要 |
| `OPENAI_API_KEY` | 大模型密钥 | 走 Mock 纪要 |
| `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini` | — |
| `ASR_BASE_URL` | 语音识别服务地址 | 走 Mock 逐字稿 |
| `ASR_API_KEY` | 语音识别密钥 | 走 Mock 逐字稿 |
| `ASR_MODEL` | 识别模型，默认 `whisper-1` | — |
| `ACCESS_PASSWORD` | 访问口令（登录门禁 + cookie 签名密钥） | 不启用门禁，任何人可访问 |
| `MAX_UPLOAD_MB` | 单个音频上传上限（MB） | `200` |
| `INBOX_DIR` | 录音收件箱目录 | 项目根目录下 `录音收件箱` |
| `INBOX_AUTO_PROCESS` | 设为 `0` 时只导入不自动转写 | 自动转写 |
| `FFPROBE_PATH` | ffprobe 可执行文件路径 | 自动查找 PATH / winget 默认目录 |
| `ECHONOTE_BACKUP_DIR` | 备份输出目录（`npm run backup` 与开机补跑共用） | 项目内 `backups/` |

所有外部服务在环境变量缺失时自动降级，**项目在零 Key 情况下可完整跑通**。首页右上角会显示「Mock 模式」角标。

**配置优先级：应用内设置（`Setting` 表） > `.env`。** 只要设置页里填了地址或 Key，就以设置页为准，不会和 `.env` 的旧值混用；点「清除应用内配置」可回退到 `.env`。设置页保存后立即生效，无需重启。

> 转写必须用专门的 ASR 模型（`SenseVoiceSmall`、`whisper-1`、`glm-asr-2512`…），对话模型不能转写。
> 命令行配置（适合脚本化部署，三项全通过才写 `.env`）：
> `npm run api:check -- --provider siliconflow --key sk-xxx --write`
> 可选预设：`siliconflow`（转写免费）、`zhipu`、`dashscope`、`openai`；中转站用 `--base` + `--llm-model`。

## 目录结构

```
app/
├── page.tsx                     # 首页：搜索 / 筛选 / 排序 / 批量删除 + 卡片列表
├── record/page.tsx              # 录音 / 上传页
├── processing/[id]/page.tsx     # 处理中（1.5s 轮询状态）
├── note/[id]/page.tsx           # 笔记详情：播放器 / 编辑 / 标签 / 分享
├── s/[token]/page.tsx           # 只读分享页
├── settings/page.tsx            # 设置：配置并测试 ASR / LLM + 导入备份
├── manifest.ts                  # PWA 清单
├── api/recordings/
│   ├── route.ts                 # GET 列表（q/status/sort/tag）/ POST 创建 / DELETE 批量
│   ├── [id]/route.ts            # GET 详情 / PATCH 改标题与正文 / DELETE
│   ├── [id]/audio/route.ts      # GET 音频回放（支持 Range，206 分段）
│   ├── [id]/todos/route.ts      # PUT 待办勾选
│   ├── [id]/share/route.ts      # GET 查询 / POST 开关只读分享
│   └── [id]/process/route.ts    # POST 触发转写 + 纪要（202 异步，force / stage=summary）
├── api/settings/
│   ├── route.ts                 # GET / PUT / DELETE 配置
│   └── test/route.ts            # POST 测试连接 / 列出模型
├── api/export/route.ts          # GET 全量导出（?format=json|md）
├── api/import/route.ts          # POST 从 JSON 备份恢复（?mode=skip）
├── api/maintenance/route.ts     # GET 孤儿音频统计 / POST 清理
components/                      # RecordButton / RecordingCard / EditableSection / TagEditor
                                 # AudioPlayer / ShareDialog / TodoList / Toast 等
lib/
├── prisma.ts                    # Prisma 单例
├── config.ts                    # 配置读取（DB 优先、env 兜底，带短缓存）
├── providerProbe.ts             # 服务商连通性探测（设置页与 CLI 共用）
├── asr.ts                       # transcribe() 抽象（mock + real，带 15 分钟超时）
├── llm.ts                       # summarize() 抽象（map-reduce 分段 + JSON 容错解析）
├── meetingNote.ts               # 结构化纪要模型 → Markdown 渲染
├── pipeline.ts                  # pending → transcribing → summarizing → done
├── inbox.ts                     # 录音收件箱：扫描 → 入库 → 排队转写
├── recover.ts                   # 修复"重启后卡在转写中"的记录
├── access.ts                    # 访问口令 / cookie 签名 / 扫码令牌
├── query.ts                     # 关键词 / 状态 / 标签 / 排序 → Prisma where
├── types.ts                     # 类型 + JSON 字段解析 + 标签规范化
├── format.ts                    # 时长 / 日期格式化
├── markdown.ts                  # 单条 + 全量 Markdown 排版
└── audioStore.ts                # 音频落盘 / 流式读写 / 孤儿清理
scripts/backup.mjs               # npm run backup：整库 + 音频，份与份之间用硬链接复用
prisma/schema.prisma
```

## 页面与交互

- **首页** `/`：搜索框（标题 / 纪要 / 逐字稿 / 标签，350ms 防抖）、状态筛选（全部 / 处理中 / 已完成 / 失败）、标签筛选（点卡片上的标签即筛选，条件进 URL）、排序（最新 / 最早 / 最长 / 最短）、批量选择与批量删除；卡片网格（桌面 3 列 / 平板 2 列 / 手机 1 列），页脚一键导出全部笔记或 JSON 备份
- **录音页** `/record`：大圆形录音按钮（112px，录制中红色 + 呼吸光环 + mm:ss 计时），支持 mp4 兼容 iOS Safari，另有上传入口
- **处理页** `/processing/[id]`：转写 / 总结两段进度，当前阶段转圈 + 骨架流光，完成打勾，失败给重试
- **详情页** `/note/[id]`：原音频播放器（0.75×–2× 倍速，Range 分段加载）、可编辑的逐字稿 / 会议纪要（Markdown 渲染）/ 待办 / 关键词（`⌘/Ctrl+Enter` 保存，改过会打「已手动编辑」标记）、标签编辑、只读分享、导出、删除；「只更新摘要」可跳过转写只换纪要
- **分享页** `/s/[token]`：拿到链接即可只读查看，无编辑 / 删除 / 导出入口，不提供音频；关闭分享后旧链接立即失效

交互细节参考 UI 提示词库实现：按压回弹与水波扩散、列表交错弹入、骨架屏流光、3D 倾斜光影、共享元素转场（卡片 → 详情）、笔画勾选与待办进度联动、Toast 堆叠让位与倒计时进度条、确认弹窗回弹并在原地切换完成态。

## 备份

```bash
npm run backup                                        # 备份到 backups/，保留最近 7 份
npm run backup -- --out "D:\EchoNote备份" --keep 14   # 指定目录与份数
node scripts/backup.mjs --no-audio                    # 只备份数据库
```

- 内容是**整库 + 全部音频 + package.json**（顺带记下备份对应哪一版代码）
- **音频在份与份之间用硬链接复用**：同名同大小的文件不重复写入，第 2 份起几乎不占空间。
  实测 250MB 音频，新增一份实际只占 252KB（仅数据库副本）。跨卷或文件系统不支持硬链接时自动退回真实复制
- `--catch-up` 用于开机补跑：最近一份不足 20 小时就直接退出。`scripts/boot.mjs` 在服务就绪 60 秒后调用一次，
  补上「定时任务到点时机器关机、当天就没备份」这个洞
- 清理旧备份只认 `20261110-030000` 这种目录名，不会误删目标目录里的其他文件

## 部署到 Vercel

1. 把代码推到 GitHub 仓库
2. Vercel → Import Project → 选择该仓库
3. 数据库切换为 Postgres（Vercel Postgres / Neon / Supabase 均可）：
   - `prisma/schema.prisma` 中把 `datasource db` 的 `provider` 改为 `"postgresql"`
   - 在 Vercel 项目环境变量里配置 `DATABASE_URL="postgresql://..."`
4. 在 Vercel 环境变量中配置 `OPENAI_*` / `ASR_*`（不配置则线上走 Mock）
5. Build Command 设为 `prisma generate && prisma db push && next build`（首次部署需要 `db push` 建表）
6. 部署完成后用 HTTPS 域名访问（**手机录音必须 HTTPS**）

## 自检（回归用）

仓库自带两套可重复执行的验收脚本，改完代码跑一遍就知道有没有打破链路：

```bash
npm run dev            # 另开一个终端

# 1) 接口/状态机全链路（123 项）
npm run smoke          # 默认 http://127.0.0.1:3000

# 2) 真实浏览器 UI 验收（84 项，需要本机 Chrome）
node scripts/ui-check.mjs http://127.0.0.1:3000

# 3) 整库 + 音频备份
npm run backup
```

> **两个测试脚本都会临时停用真实的 API Key。** 它们传的是随机字节 / 虚拟麦克风合成的音调，
> 真实语音识别接口拿不到有意义的文本，所以跑之前会把 `Setting` 表里的 `asr_api_key`、
> `llm_api_key` 两行摘掉（保留 `base_url`，不会回落到 `.env`），pipeline 因此走 Mock；
> 结束时、异常退出、Ctrl+C 都会自动还原。看到输出里那句「临时停用 N 项」是正常的，
> 不是把你的配置删了。实现见 `scripts/test-mode.mjs`。

- `smoke` 覆盖：创建校验（缺音频/0 秒/非法时长/超大文件）、状态机流转（80ms 轮询捕捉中间态）、逐字稿与纪要解析、幂等触发、`force=1` 重跑、待办勾选持久化与非法下标过滤、音频落盘、设置接口（含密钥不回传明文 / 非法地址拒绝）、详情页 SSR、标题 PATCH 校验、列表字段裁剪、删除与 404、关键词搜索 / 状态筛选 / 排序、批量删除（空 ids / 非法 body / 忽略不存在 id）、JSON 与 Markdown 导出、**音频 Range（200/206/416/非法头/无音频 404）**、**正文 PATCH（各字段 + 空 body + 超长 + 类型错误 + 标签去重限量）**、**stage=summary（无逐字稿时 400）**、**分享生命周期（生成/访问/关闭/旧链接失效/不存在 token）**、**标签筛选（精确匹配不误伤）**、**导入（覆盖 / skip / 脏数据不卡死 / 非备份文件 400）**。
- `ui-check` 覆盖：375px 无横向滚动、移动端卡片删除按钮可见且 ≥44px、桌面 3 列 / 详情两栏、录音按钮尺寸、真实录音全链路（虚拟麦克风 → MediaRecorder → 上传 → 处理 → 自动跳详情）、待办勾选联动与刷新后仍保持、删除弹窗居中且挂载在 body、标题编辑、Markdown 真的下载到本地、process 请求失败时的停滞兜底与恢复、搜索命中/空结果/清空、批量选择模式（点卡片勾选而非跳转、全选、删除按钮计数、退出）、设置页交互（预设填入 / 测试按钮 / 保存）、控制台报错、**音频播放器存在且 src 指向音频接口 + 分段可读**、**在页面上改摘要并落库（含「已手动编辑」标记出现）**、**加/删标签真的写库**、**生成分享链接并在弹窗里拿到 URL、打开分享页确认无编辑入口**、**窄屏下播放器与 5 个操作按钮不撑破页面**。
- 截图会输出到 `shots/`。

## 已知边界

- **process 是进程内异步任务**：`POST .../process` 立即返回 202，真正转写/总结在后台跑。Vercel 这类 Serverless 环境需要把 `maxDuration` 调大，或改成队列/后台函数，否则长音频会被截断。
- **处理中途被打断的兜底**：进程重启会丢掉内存里的任务，`lib/recover.ts` 会在服务启动后第一次访问时把残留的 `transcribing / summarizing` 记录标成「处理被中断」，并兜底扫描超过 10 分钟没动静的任务。音频已落盘，点「重新处理」即可。代价是：如果重启时恰好有长音频在转，它会被判为中断（可重试，不会丢录音）。
- **Prisma 的 DateTime 过滤在 SQLite 上不可靠**：本库把 DateTime 存成 ISO 文本，而 `where: { updatedAt: { lt: Date } }` 会按整数绑定比较，实测恒返回 0 条。所以涉及时间的比较都在 JS 层做（见 `lib/recover.ts`），排序用 `orderBy` 字符串排序（ISO 字典序 == 时间序）。
- 手机录音**必须 HTTPS**（浏览器 getUserMedia 限制），本地 `localhost` 除外。`npm run serve` / `启动网站.bat` 已经内置了 3443 的 HTTPS，手机用自签证书访问，首次点「继续访问」即可；具体连法（同一路由器 / USB 共享网络 / 录完再上传）见 `使用文档.md` 11.2。
- **录音必须前台**：锁屏或切走浏览器会中断，后台录音需要原生 App。
- 单用户：没有账号隔离，公网部署前必须加访问控制。
- 删除确认有一条 780ms 的「打勾」完成动画（UI 稿要求），所以卡片消失会比点击慢一拍，不是卡住。
- **分享是"知道链接就能看"**：令牌 32 位随机不可猜，但页面本身没有密码，也没有账号体系；不要在公网暴露包含敏感内容的分享链接。
- **JSON 导入不含音频**：备份只覆盖文字内容，导回来的记录没有播放器、也不能重新转写；要连音频一起搬用 `npm run backup`。导入时若遇到 `pending/transcribing/summarizing` 状态，会强制标成 `error`（`error` 文案说明原因），避免永久转圈。
- **标签存成 JSON 字符串**：SQLite 的 `contains` 匹配 `"标签"`（带引号）以避免 `产品` 命中 `产品经理`；记录量很大时可以考虑迁到关系表 + `json_each`。
- **Windows 上删除音频可能失败**：浏览器仍在播放时会持有文件句柄，`rmSync` 抛 `EPERM`。`dropAudio` 已改成逐文件容错（一个失败不影响其他），漏掉的会在设置页显示为「孤儿音频」并可一键清理。

## 验收自检

- [x] 零 API Key：录音 → 提交 → 看到处理进度 → 详情看到 Mock 逐字稿与纪要 → 首页看到记录 → 编辑标题 → 导出 md → 删除
- [x] 刷新页面数据不丢失（SQLite 持久化）
- [x] 375px 宽度无横向滚动，按钮高度 ≥44px
- [x] 原音频可回放，拖动进度条正常（Range 分段）
- [x] 逐字稿 / 摘要 / 待办 / 关键词 / 标签可改，刷新后仍在
- [x] 只读分享链接可用，关闭后旧链接立即失效
- [x] JSON 导出后能导入恢复；`npm run backup` 的备份能覆盖回 `prisma/dev.db` 生效
- [x] `npm run build` 无 TypeScript / ESLint 报错
- [x] 删除记录时音频文件一起清掉，残留可一键清理
- [x] `npm run smoke` 123/123、`node scripts/ui-check.mjs` 89/89（dev 与 `next start` 生产模式都跑过）

## License

[MIT](./LICENSE)
