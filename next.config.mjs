/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 不回传 X-Powered-By，减少无意义指纹
  poweredByHeader: false,
  // 默认 .next；需要并行跑 dev 与 build 时可用 NEXT_DIST_DIR 指到别的目录，
  // 避免两个进程抢同一个 .next/trace（Windows 上表现为 EPERM）
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
