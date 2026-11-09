/**
 * 局域网地址探测 + 二维码打印，被 serve-https.mjs 和 lan-url.mjs 共用。
 */

import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginTokenFor, withToken } from "./qr-token.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 越像「手机连得上的局域网」排越前 */
function rank(ip) {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return 2;
  return 3;
}

export function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== "IPv4" || item.internal) continue;
      // 169.254.x.x 是链路本地地址，手机永远连不上
      if (item.address.startsWith("169.254.")) continue;
      found.push({ name, address: item.address });
    }
  }
  return found.sort((a, b) => rank(a.address) - rank(b.address));
}

/**
 * 判斷这个地址手机有没有可能连上。
 * 192.168.x.x 基本就是家用路由器 / 手机热点 / USB 共享网络，手机大概率能访问；
 * 其余网段（校园网、公司网）通常有客户端隔离，手机一般够不着。
 */
export function likelyReachable(ip) {
  return ip.startsWith("192.168.");
}

/** 打印二维码，失败就算了，不影响使用 */
export async function printQr(text) {
  try {
    const { default: qr } = await import("qrcode-terminal");
    await new Promise((resolve) => qr.generate(text, { small: true }, (code) => {
      console.log(code);
      resolve();
    }));
  } catch {
    console.log("  " + text);
  }
}

/** 把「手机怎么连」整套提示打出来 */
export async function reportPhoneUrl(port) {
  const list = lanAddresses();
  if (list.length === 0) {
    console.log("  手机  （没检测到局域网地址，先把网络连上）");
    return;
  }

  const primary = list[0];
  const url = `https://${primary.address}:${port}`;
  const token = loginTokenFor(root);
  // 扫码地址里带当天令牌：换网络导致 IP 变了，重新扫一次就行，不用手打口令
  const scanUrl = withToken(url, token);

  console.log(`  手机  ${url}`);
  const others = list.slice(1).filter((a) => !a.name.toLowerCase().includes("wsl"));
  if (others.length > 0) {
    console.log("        其他地址：" + others.map((a) => a.address).join("、"));
  }

  if (likelyReachable(primary.address)) {
    console.log("        手机连上同一个 Wi-Fi / 热点后，直接打开这个地址。");
  } else {
    console.log("");
    console.log("  [!] 当前网络是隔离型（校园网/公司网），手机多半连不上这个地址。");
    console.log("      不影响使用：把录音文件放进「录音收件箱」文件夹，一样会自动转写。");
  }
  console.log("      首次打开提示「证书不安全」，选「继续访问」即可。");
  console.log("");
  console.log("  手机扫这个码（今天有效，扫了不用输口令）：");
  console.log("");
  await printQr(scanUrl);
  console.log("  别再翻这个窗口了：把录音丢进「录音收件箱」也能直接转写。");
  console.log("");
}
