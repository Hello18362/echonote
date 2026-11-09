"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { takeOrigin } from "@/lib/transition";

/**
 * 03-05 / 04-18 共享元素转场：从列表卡片原位展开成详情面板
 */
export function SharedPanel({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const origin = takeOrigin(id);
    const el = ref.current;
    if (!origin || !el) return;

    const r = el.getBoundingClientRect();
    if (!r.width) return;

    el.style.setProperty("--tx", `${origin.left - r.left}px`);
    el.style.setProperty("--ty", `${origin.top - r.top}px`);
    el.style.setProperty("--ts", String(Math.max(0.2, Math.min(1, origin.width / r.width))));
    el.style.transformOrigin = "top left";
    setAnimating(true);

    const timer = setTimeout(() => setAnimating(false), 460);
    return () => clearTimeout(timer);
  }, [id]);

  return (
    <div ref={ref} className={cn(animating && "shared-enter", className)}>
      {children}
    </div>
  );
}
