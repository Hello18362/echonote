"use client";

/**
 * 03-05 / 04-18 共享元素转场：
 * 列表卡片点击时记录自身位置，详情页挂载时从该位置展开。
 * 仅在同一客户端会话内有效（跨路由但同页面实例）。
 */
export type OriginRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

let pending: { id: string; rect: OriginRect; at: number } | null = null;

export function setOrigin(id: string, rect: OriginRect) {
  pending = { id, rect, at: Date.now() };
}

export function takeOrigin(id: string): OriginRect | null {
  if (!pending || pending.id !== id) return null;
  if (Date.now() - pending.at > 2000) {
    pending = null;
    return null;
  }
  const { rect } = pending;
  pending = null;
  return rect;
}
