"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertIcon, CheckIcon } from "@/components/Icons";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; text: string; kind: ToastKind };

type ToastApi = {
  toast: (text: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toast: () => {} };
  return ctx;
}

const SLOT = 58;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = ++seq.current;
    // 05-03 提示堆叠让位：新提示进场前，旧的先上移一格
    setItems((prev) => [{ id, text, kind }, ...prev].slice(0, 3));
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:justify-end">
        <div className="relative w-full max-w-[92vw] sm:w-[320px]">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="toast-enter pointer-events-auto absolute bottom-0 left-0 w-full"
              style={{
                transform: `translateY(${-index * SLOT}px) scale(${1 - index * 0.03})`,
                transition: "transform 320ms cubic-bezier(0.34,1.56,0.64,1), opacity 240ms ease",
                zIndex: 30 - index,
                opacity: index > 2 ? 0 : 1,
              }}
            >
              <div className="relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 px-4 py-3 text-sm text-slate-700 shadow-pop backdrop-blur">
                <span
                  className={
                    item.kind === "success"
                      ? "flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
                      : item.kind === "error"
                        ? "flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-red-600"
                        : "flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-brand-600"
                  }
                >
                  {item.kind === "error" ? (
                    <AlertIcon className="h-4 w-4" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                </span>
                <span className="flex-1 truncate">{item.text}</span>
                {/* 05-04 撤销进度条：倒计时走完提示才消失 */}
                <span className="absolute bottom-0 left-0 h-[2px] w-full bg-slate-100">
                  <span
                    className={
                      item.kind === "error"
                        ? "block h-full bg-red-400"
                        : "block h-full bg-brand-500"
                    }
                    style={{
                      animation: "toast-progress 2800ms linear forwards",
                      transformOrigin: "left",
                    }}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
