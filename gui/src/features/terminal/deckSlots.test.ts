import { describe, expect, it } from 'vitest';

import type { TerminalInfo } from './client.js';
import { adoptRunning, closeSlot, firstSlot, placeLaunch, slotLabels, type Slot } from './deckSlots.js';

const terminal = (id: string, target = 'claude', state: TerminalInfo['state'] = 'running'): TerminalInfo => ({ id, workspace: 'w', target, label: target, cwd: '/w', state });

describe('adoptRunning', () => {
  it('lets the first tab take over the first running terminal and gives each other one a tab', () => {
    const slots = adoptRunning([firstSlot()], [terminal('a'), terminal('b', 'codex'), terminal('c', 'shell', 'exited')]);
    expect(slots).toEqual([{ key: 'main', terminalId: 'a' }, { key: 'b', terminalId: 'b' }]);
  });

  it('adopts only once: a tab the developer opened for a new session is never filled from the list', () => {
    const once = adoptRunning([firstSlot()], []);
    expect(once).toEqual([{ key: 'main', terminalId: null }]);
    const later = adoptRunning(once, [terminal('a')]);
    expect(later).toEqual([{ key: 'main', terminalId: null }, { key: 'a', terminalId: 'a' }]);
  });

  it('does not take a terminal another tab already shows, and keeps the same array when nothing changes', () => {
    const slots: Slot[] = [{ key: 'main', terminalId: 'a' }, { key: 'x', terminalId: null }];
    expect(adoptRunning(slots, [terminal('a')])).toBe(slots);
  });

  it('leaves a first tab that is about to start something alone', () => {
    const slots = adoptRunning([{ ...firstSlot(), launch: { id: 'l', target: 'codex' } }], [terminal('a')]);
    expect(slots).toEqual([{ key: 'main', terminalId: null, launch: { id: 'l', target: 'codex' } }, { key: 'a', terminalId: 'a' }]);
  });
});

describe('slotLabels', () => {
  it('names a tab after its tool, numbers a second of the same, and calls an empty one New session', () => {
    const slots: Slot[] = [{ key: '1', terminalId: 'a' }, { key: '2', terminalId: 'b' }, { key: '3', terminalId: 'c' }, { key: '4', terminalId: null }];
    const targets: Record<string, string> = { 1: 'claude', 2: 'codex', 3: 'claude' };
    expect([...slotLabels(slots, (slot) => targets[slot.key]).values()]).toEqual(['Claude Code', 'Codex', 'Claude Code 2', 'New session']);
  });
});

describe('closeSlot', () => {
  const slots: Slot[] = [{ key: 'a', terminalId: '1' }, { key: 'b', terminalId: '2' }, { key: 'c', terminalId: '3' }];

  it('shows the next tab, else the previous, when the one on screen closes', () => {
    expect(closeSlot(slots, 'b', 'b', null)).toMatchObject({ active: 'c', split: null });
    expect(closeSlot(slots, 'c', 'c', null)).toMatchObject({ active: 'b' });
    expect(closeSlot(slots, 'a', 'c', null)).toMatchObject({ active: 'c', slots: [{ key: 'b' }, { key: 'c' }] });
  });

  it('ends the side-by-side view when either side closes, or when one tab is left', () => {
    expect(closeSlot(slots, 'c', 'a', 'c')).toMatchObject({ active: 'a', split: null });
    expect(closeSlot(slots, 'a', 'a', 'b')).toMatchObject({ active: 'c', split: 'b' });
    expect(closeSlot(slots.slice(0, 2), 'b', 'a', 'b')).toMatchObject({ active: 'a', split: null });
  });

  it('never leaves a workspace without a tab', () => {
    const result = closeSlot([{ key: 'a', terminalId: '1' }], 'a', 'a', null);
    expect(result.slots).toEqual([{ key: 'new-a', terminalId: null }]);
    expect(result.active).toBe('new-a');
  });

  it('ignores a tab that is not there', () => {
    expect(closeSlot(slots, 'zz', 'a', null)).toEqual({ slots, active: 'a', split: null });
  });
});

describe('placeLaunch', () => {
  const launch = { id: 'l1', target: 'claude', sessionId: 's1' };

  it('uses the tab on screen when nothing runs there', () => {
    const result = placeLaunch([{ key: 'main', terminalId: null, adopt: true }], 'main', launch, 'n');
    expect(result).toEqual({ slots: [{ key: 'main', terminalId: null, launch, adopt: undefined }], active: 'main' });
  });

  it('opens a new tab rather than replacing a session that runs', () => {
    const result = placeLaunch([{ key: 'main', terminalId: 'a' }], 'main', launch, 'n');
    expect(result).toEqual({ slots: [{ key: 'main', terminalId: 'a' }, { key: 'n', terminalId: null, launch }], active: 'n' });
  });
});
