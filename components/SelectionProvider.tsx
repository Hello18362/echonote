"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SelectionContextValue = {
  /** 是否处于多选模式 */
  active: boolean;
  setActive: (v: boolean) => void;
  selected: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  /** 全选页面上已渲染的卡片（从 DOM 读，避免服务端/客户端 id 列表不同步） */
  selectAllRendered: () => void;
  /** 页面上当前渲染的卡片 id */
  renderedIds: () => string[];
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const setActive = useCallback((v: boolean) => {
    setActiveState(v);
    if (!v) setSelected([]);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const renderedIds = useCallback(() => {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-recording-id]"))
      .map((el) => el.dataset.recordingId ?? "")
      .filter(Boolean);
  }, []);

  const selectAllRendered = useCallback(() => {
    setSelected(renderedIds());
  }, [renderedIds]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      active,
      setActive,
      selected,
      isSelected: (id: string) => selected.includes(id),
      toggle,
      clear,
      selectAllRendered,
      renderedIds,
    }),
    [active, setActive, selected, toggle, clear, selectAllRendered, renderedIds],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** 在 Provider 外调用时返回一个"永不多选"的安全默认值，方便组件复用 */
export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (ctx) return ctx;
  return {
    active: false,
    setActive: () => {},
    selected: [],
    isSelected: () => false,
    toggle: () => {},
    clear: () => {},
    selectAllRendered: () => {},
    renderedIds: () => [],
  };
}
