import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#fafafa",
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.05)",
        "card-hover":
          "0 2px 4px rgba(15,23,42,0.06), 0 12px 32px rgba(15,23,42,0.10)",
        pop: "0 8px 12px rgba(15,23,42,0.06), 0 24px 60px rgba(15,23,42,0.18)",
        "inner-press": "inset 0 2px 6px rgba(15,23,42,0.16)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      transitionTimingFunction: {
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
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.98)" },
          "70%": { opacity: "1", transform: "translateY(-2px) scale(1.005)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
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
        "pop-in": "pop-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "fade-in": "fade-in 200ms ease-out both",
        "rise-in": "rise-in 420ms cubic-bezier(0.22, 1.2, 0.36, 1) both",
        "toast-in": "toast-in 280ms cubic-bezier(0.22, 1.2, 0.36, 1) both",
        shimmer: "shimmer 1.6s infinite",
        breathe: "breathe 1.8s ease-out infinite",
        "spin-slow": "spin-slow 900ms linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
