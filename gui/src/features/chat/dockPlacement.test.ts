import { describe, expect, it, vi } from 'vitest';

import { chatDockSlot, sameDockRect, toDockRect } from './dockPlacement';

describe('toDockRect', () => {
  it('rounds to whole pixels, so a fractional layout does not make the dock chase the slot', () => {
    expect(toDockRect({ left: 10.4, top: 20.6, width: 300.5, height: 400.49 })).toEqual({ left: 10, top: 21, width: 301, height: 400 });
  });
});

describe('sameDockRect', () => {
  const a = { left: 1, top: 2, width: 3, height: 4 };
  it('compares each side', () => {
    expect(sameDockRect(a, { ...a })).toBe(true);
    for (const key of ['left', 'top', 'width', 'height'] as const) expect(sameDockRect(a, { ...a, [key]: 9 })).toBe(false);
  });

  it('treats two missing rects as the same and a missing one as different from a real one', () => {
    expect(sameDockRect(null, null)).toBe(true);
    expect(sameDockRect(a, null)).toBe(false);
    expect(sameDockRect(null, a)).toBe(false);
  });
});

describe('chatDockSlot', () => {
  it('tells listeners when the slot appears and goes, and stays quiet when nothing changed', () => {
    const element = {} as HTMLElement;
    const listener = vi.fn();
    const unsubscribe = chatDockSlot.subscribe(listener);
    chatDockSlot.set(element);
    expect(chatDockSlot.get()).toBe(element);
    chatDockSlot.set(element);
    expect(listener).toHaveBeenCalledTimes(1);
    chatDockSlot.set(null);
    expect(chatDockSlot.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    chatDockSlot.set(element);
    expect(listener).toHaveBeenCalledTimes(2);
    chatDockSlot.set(null);
  });
});
