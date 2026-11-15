# 安全策略 / Security Policy

## 支持范围

只对**最新提交的 `main` 分支**提供安全修复。历史版本请自行升级。

## 本项目的安全边界

EchoNote 是单机应用，安全面主要有四类：

1. **密钥泄漏**：`OPENAI_API_KEY` / `ASR_API_KEY` 被写入日志、导出的备份、错误信息或提交进仓库；
2. **访问控制**：未设置 `ACCESS_PASSWORD` 就暴露到公网；口令过弱；cookie 签名被伪造；
3. **分享链接**：`/s/<token>` 只读分享链接被猜中、被搜索引擎收录、关闭后仍可访问；
4. **服务端风险**：上传接口的路径穿越、超大文件耗尽磁盘、SSRF（把 `base_url` 指向内网地址）、命令注入。

**不属于安全范畴**：转写错字、纪要质量、模型幻觉、UI 样式问题——这些请走普通 Issue。

## 报告漏洞

**请不要通过公开 Issue 报告安全问题。**

任选其一：

- 使用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)（仓库 **Security** 标签页 → Report a vulnerability）；
- 或发邮件至仓库所有者邮箱（见 GitHub 个人主页）。

报告时请包含：

- 复现步骤与影响范围（能读到什么、能改什么）；
- 你的环境（系统、Node 版本、部署方式：本机 / 局域网 / 公网）；
- 必要的日志片段——**请先脱敏**，不要贴真实录音、转写文本或 Key。

我通常会在 7 天内回复。修复发布前请勿公开细节。

## 密钥泄漏处置

如果你不小心把 Key 提交进了仓库或贴进了公开 Issue：

1. **立即去服务商后台吊销该 Key**（这一步比清理 git 历史更紧急）；
2. 若已推送，历史里仍能翻到——清理需要改写历史并强制推送，或直接删除仓库重建；
3. 检查 `backups/` 与导出的 JSON 备份里是否也带上了 Key（本项目的备份只含数据库，正常情况下不含 `.env`）。

## 安全默认值

- `ACCESS_PASSWORD` 留空 = **不启用门禁**，仅适合本机或可信局域网；
- 分享链接是「知道链接就能看」，令牌 32 位随机，但**没有密码**；
- 设置页保存的 Key 存在本地 SQLite 中，接口不回传明文（见 `app/api/settings/route.ts`）；
- 上传大小受 `MAX_UPLOAD_MB` 限制，默认 200 MB。