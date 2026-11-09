import type { Config } from "tailwindcss";

/**
 * 视觉基准：apple.com 的设计语言
 * - 背景在 #ffffff 与 #f5f5f7 之间交替
 * - 正文 #1d1d1f，次要文字 #6e6e73，分割线 #d2d2d7
 * - 强调色 #0071e3（链接/按钮），hover #0077ed
 * - 胶囊按钮（radius 980px）、大圆角卡片（18–28px）
 * - 几乎不用重阴影，靠底色对比分层
 *
 * 这里直接把 slate / brand 两套色阶替换掉，
 * 组件里原有的 text-slate-500、bg-brand-600 会整体变成苹果灰与苹果蓝，
 * 不需要一个个改 className。
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f5f7",
        surface: "#ffffff",
        ink: "#1d1d1f",
        muted: "#6e6e73",
        line: "#d2d2d7",
        brand: {
          50: "#e8f3ff",
          100: "#d0e7ff",
          200: "#a8d4ff",
          300: "#6fbaff",
          400: "#3d9bff",
          500: "#0a84ff",
          600: "#0071e3",
          700: "#0066cc",
          800: "#0052a3",
          900: "#003d7a",
        },
        // 苹果的灰阶，替换 Tailwind 默认的冷灰
        slate: {
          50: "#f5f5f7",
          100: "#e8e8ed",
          200: "#d2d2d7",
          300: "#a1a1a6",
          400: "#86868b",
          500: "#6e6e73",
          600: "#515154",
          700: "#424245",
          800: "#2c2c2e",
          900: "#1d1d1f",
          950: "#000000",
        },
      },
      fontFamily: {
        sans: [
          "SF Pro Display",
          "SF Pro Text",
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Helvetica Neue",
          "sans-serif",
        ],
      },
      // 苹果的卡片阴影极轻，主要靠白底与灰底的对比分层
      boxShadow: {
        card: "0 0 0 1px rgba(0,0,0,0.02), 0 2px 10px rgba(0,0,0,0.04)",
        "card-hover": "0 0 0 1px rgba(0,0,0,0.03), 0 6px 24px rgba(0,0,0,0.08)",
        pop: "0 8px 12px rgba(0,0,0,0.06), 0 24px 60px rgba(0,0,0,0.16)",
        "inner-press": "inset 0 1px 3px rgba(0,0,0,0.12)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
        pill: "980px",
      },
      transitionTimingFunction: {
        // 苹果的缓动偏 ease-out，几乎不用过冲
        apple: "cubic-bezier(0.28, 0.11, 0.32, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "spring-soft": "cubic-bezier(0.22, 1.2, 0.36, 1)",
        damp: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.92) translateY(8px)" },
          "60%": { opacity: "1", transform: "scale(1.02) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(18px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.55" },
          "50%": { transform: "scale(1.16)", opacity: "0" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "pop-in": "pop-in 260ms cubic-bezier(0.28, 0.11, 0.32, 1) both",
        "fade-in": "fade-in 240ms ease-out both",
        "rise-in": "rise-in 420ms cubic-bezier(0.28, 0.11, 0.32, 1) both",
        "toast-in": "toast-in 280ms cubic-bezier(0.28, 0.11, 0.32, 1) both",
        shimmer: "shimmer 1.6s infinite",
        breathe: "breathe 1.8s ease-out infinite",
        "spin-slow": "spin-slow 900ms linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
