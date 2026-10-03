import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Where the docked chat sits. The chat lives above the router, so its terminals
 * keep running and keep their scrollback when the user moves between a
 * workspace's destinations or between workspaces. The Chat destination renders an
 * empty slot, and the dock lays itself over that slot. The dock is never moved in
 * the DOM: moving a terminal's elements would reset it. Only its box changes.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export const chatDockSlot = {
  get: () => slot,
  /** The Chat destination registers its slot when it mounts and passes null when it goes. */
  set: (element: HTMLElement | null) => {
    if (element === slot) return;
    slot = element;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

/** The slot element while the Chat destination is on screen, otherwise null. */
export function useChatDockSlot(): HTMLElement | null {
  return useSyncExternalStore(chatDockSlot.subscribe, chatDockSlot.get, () => null);
}

/** Whether the chat is on screen right now. Alerts and focus follow this, not whether tabs are open. */
export function useChatVisible(): boolean {
  return useChatDockSlot() !== null;
}

export interface DockRect { left: number; top: number; width: number; height: number }

/** Whole pixels, so a fractional layout does not make the dock chase the slot with sub-pixel updates. */
export function toDockRect(rect: { left: number; top: number; width: number; height: number }): DockRect {
  return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
}

export function sameDockRect(a: DockRect | null, b: DockRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * The slot's box in the window, kept current as the window, the slot or the
 * page around it changes. Null while there is no slot.
 */
export function useDockRect(element: HTMLElement | null): DockRect | null {
  const [rect, setRect] = useState<DockRect | null>(null);
  useLayoutEffect(() => {
    if (!element) { setRect(null); return; }
    const update = () => {
      const next = toDockRect(element.getBoundingClientRect());
      setRect((current) => (sameDockRect(current, next) ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener('resize', update);
    // A scroll in any ancestor moves the slot without resizing it.
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [element]);
  return rect;
}
