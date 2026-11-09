"use client";

import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "danger" | "dangerGhost" | "outline" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  primary: "btn-primary",
  danger: "bg-red-500 text-white hover:bg-red-600",
  // 页面主操作区里的删除：淡红底、红字，不跟主按钮抢注意力；
  // 真正的 destructive 确认仍用实心 danger
  dangerGhost: "bg-red-50 text-red-600 hover:bg-red-100",
  outline: "btn-secondary",
  ghost: "btn-ghost",
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
        "btn-pill relative inline-flex min-h-[44px] select-none items-center justify-center gap-2 overflow-hidden px-5 text-[15px]",
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
