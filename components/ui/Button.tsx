"use client";

import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "danger" | "outline" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  outline: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
};

type Ripple = { id: number; x: number; y: number; size: number };

/**
 * 通用按钮：
 * - 02-11 / 04-01 按压回弹（.pressable）
 * - 04-03 水波从触点扩散（不是从中心冒出）
 */
export function Button({
  variant = "primary",
  className,
  children,
  onPointerDown,
  ...rest
}: Props) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const seq = useRef(0);

  const spawnRipple = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const id = ++seq.current;
      setRipples((prev) => [
        ...prev,
        { id, x: e.clientX - rect.left, y: e.clientY - rect.top, size },
      ]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 540);
    },
    [],
  );

  return (
    <button
      {...rest}
      onPointerDown={(e) => {
        spawnRipple(e);
        onPointerDown?.(e);
      }}
      className={cn(
        "pressable relative inline-flex min-h-[44px] select-none items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-medium",
        VARIANTS[variant],
        className,
      )}
    >
      <span className="ripple-layer">
        {ripples.map((r) => (
          <span
            key={r.id}
            className="ripple"
            style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          />
        ))}
      </span>
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
}
