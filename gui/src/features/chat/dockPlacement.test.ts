import { describe, expect, it, vi } from 'vitest';

import { chatDockSlot, sameDockRect, toDockRect } from './dockPlacement';

describe('toDockRect', () => {
  it('rounds to whole pixels, so a fractional layout does not make the dock chase the slot', () => {
    expect(toDockRect({ left: 10.4, top: 20.6, width: 300.5, height: 400.49 })).toEqual({ left: 10, top: 21, width: 301, height: 400 });
  });

  it('clamps height so the dock never exceeds window.innerHeight - top', () => {
    try {
      vi.stubGlobal('window', { innerHeight: 600 });
      // rect exceeds viewport: top 100 + height 700 = 800 > 600 => clamped to 500
      expect(toDockRect({ left: 20, top: 100, width: 400, height: 700 })).toEqual({
        left: 20,
        top: 100,
        width: 400,
        height: 500,
      });

      // rect fits within viewport: top 100 + height 400 = 500 <= 600 => unchanged
      expect(toDockRect({ left: 20, top: 100, width: 400, height: 400 })).toEqual({
        left: 20,
        top: 100,
        width: 400,
        height: 400,
      });

      // rect top is beyond viewport: top 700 >= 600 => clamped to 0
      expect(toDockRect({ left: 20, top: 700, width: 400, height: 200 })).toEqual({
        left: 20,
        top: 700,
        width: 400,
        height: 0,
      });

      // rect with negative dimensions is safely clamped to 0
      expect(toDockRect({ left: 10, top: 10, width: -50, height: -100 })).toEqual({
        left: 10,
        top: 10,
        width: 0,
        height: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('safely handles non-finite innerHeight or missing window', () => {
    try {
      vi.stubGlobal('window', { innerHeight: NaN });
      expect(toDockRect({ left: 10, top: 20, width: 300, height: 400 })).toEqual({
        left: 10,
        top: 20,
        width: 300,
        height: 400,
      });
    } finally {
      vi.unstubAllGlobals();
    }
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
