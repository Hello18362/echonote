/**
 * 生成 PWA 图标（不依赖任何图形库，直接编码 PNG）
 * 用法：node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 圆角矩形内部判定 */
function insideRoundRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function draw(size, { bg, fg, padding = 0 }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;

  const radius = size * 0.235;
  const rect = { left: padding, top: padding, right: size - padding, bottom: size - padding };

  // 五根竖条构成声波
  const bars = [
    { x: 0.3, y: 0.36, h: 0.28 },
    { x: 0.405, y: 0.29, h: 0.42 },
    { x: 0.51, y: 0.22, h: 0.56 },
    { x: 0.615, y: 0.29, h: 0.42 },
    { x: 0.72, y: 0.36, h: 0.28 },
  ].map((b) => ({
    left: size * b.x - size * 0.031,
    right: size * b.x + size * 0.031,
    top: size * b.y,
    bottom: size * (b.y + b.h),
    radius: size * 0.031,
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let barHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS;
          const py0 = y + (sy + 0.5) / SS;
          if (insideRoundRect(px0, py0, rect.left, rect.top, rect.right, rect.bottom, radius)) {
            bgHits++;
            if (bars.some((b) => insideRoundRect(px0, py0, b.left, b.top, b.right, b.bottom, b.radius))) {
              barHits++;
            }
          }
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      const barA = barHits / total;

      const r = bg[0] * (1 - barA) + fg[0] * barA;
      const g = bg[1] * (1 - barA) + fg[1] * barA;
      const b = bg[2] * (1 - barA) + fg[2] * barA;

      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(bgA * 255);
    }
  }

  return px;
}

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

mkdirSync("public/icons", { recursive: true });

const targets = [
  { file: "public/icons/icon-192.png", size: 192, padding: 0 },
  { file: "public/icons/icon-512.png", size: 512, padding: 0 },
  // maskable 需要留安全边距，否则被系统裁掉边角
  { file: "public/icons/maskable-512.png", size: 512, padding: 46 },
  { file: "public/apple-touch-icon.png", size: 180, padding: 0 },
];

for (const t of targets) {
  const png = encodePng(t.size, draw(t.size, { bg: BLUE, fg: WHITE, padding: t.padding }));
  writeFileSync(t.file, png);
  console.log(`${t.file}  ${(png.length / 1024).toFixed(1)} KB`);
}
