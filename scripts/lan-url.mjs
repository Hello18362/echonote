#!/usr/bin/env node
/**
 * 服务已经在跑的时候，单独把手机地址和二维码打印出来。
 * 被 启动网站.bat 调用。
 */

import { reportPhoneUrl } from "./lan-info.mjs";

const port = Number(process.env.HTTPS_PORT ?? 3443);
await reportPhoneUrl(port);
