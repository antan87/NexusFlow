/**
 * The CLI sessions of one workspace, as tabs: one per terminal, so Claude Code and Codex (or two of either) can work
 * in the same workspace at once, each visible a click away or side by side. Pure, so the rules can be tested without a
 * DOM; the deck component holds the state and the terminals themselves live on the server.
 */

import { harnessName } from '../../components/icons/HarnessIcon.js';
import type { TerminalInfo, TerminalLaunch } from './client.js';

export interface Slot {
  /** Stable for the life of the tab. */
  key: string;
  /** The terminal this tab shows, once it has one. */
  terminalId: string | null;
  /** A start or resume the tab should make as soon as it is shown. */
  launch?: TerminalLaunch;
  /** Only the first tab, until the server's list has been read once: it takes over a terminal that is already running. */
  adopt?: boolean;
}

export const firstSlot = (): Slot => ({ key: 'main', terminalId: null, adopt: true });

/**
 * Gives every running terminal of the workspace a tab, so none runs out of sight (after a reload, a start from another
 * window, or a resume that replaced a tab's terminal). The first tab, while it still waits, takes the first one; each
 * other gets a tab of its own, in the server's order. Returns the same array when nothing changes.
 */
export function adoptRunning(slots: readonly Slot[], sessions: readonly TerminalInfo[]): readonly Slot[] {
  const bound = new Set(slots.map((slot) => slot.terminalId).filter((id): id is string => id !== null));
  const free = sessions.filter((session) => session.state === 'running' && !bound.has(session.id));
  const adopting = slots.some((slot) => slot.adopt);
  if (free.length === 0 && !adopting) return slots;
  const next = slots.map((slot) => {
    if (!slot.adopt) return slot;
    const rest: Slot = { ...slot };
    delete rest.adopt;
    if (rest.terminalId || rest.launch || free.length === 0) return rest;
    return { ...rest, terminalId: free.shift()!.id };
  });
  return [...next, ...free.map((session) => ({ key: session.id, terminalId: session.id }))];
}

/** What each tab is called: its tool, numbered when the workspace runs two of the same, or "New session". */
export function slotLabels(slots: readonly Slot[], targetOf: (slot: Slot) => string | undefined): Map<string, string> {
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const slot of slots) {
    const target = targetOf(slot);
    if (!target) { labels.set(slot.key, 'New session'); continue; }
    const count = (seen.get(target) ?? 0) + 1;
    seen.set(target, count);
    labels.set(slot.key, count === 1 ? harnessName(target) : `${harnessName(target)} ${count}`);
  }
  return labels;
}

/**
 * Removes a tab. The tab beside it takes its place on screen (the next one, else the previous), and a workspace never
 * has no tab: closing the last one leaves a fresh one with the tool buttons.
 */
export function closeSlot(slots: readonly Slot[], key: string, active: string, split: string | null): { slots: Slot[]; active: string; split: string | null } {
  const index = slots.findIndex((slot) => slot.key === key);
  if (index < 0) return { slots: [...slots], active, split };
  const rest = slots.filter((slot) => slot.key !== key);
  if (rest.length === 0) {
    const fresh = { key: `new-${key}`, terminalId: null };
    return { slots: [fresh], active: fresh.key, split: null };
  }
  const neighbour = (rest[index] ?? rest[index - 1])!.key;
  const nextActive = active === key ? (neighbour === split ? rest.find((slot) => slot.key !== split)?.key ?? neighbour : neighbour) : active;
  const nextSplit = split === key || split === nextActive || rest.length < 2 ? null : split;
  return { slots: rest, active: nextActive, split: nextSplit };
}

/**
 * Where a start or resume asked for from elsewhere in the app goes: into the tab on screen when it has nothing running,
 * else into a new tab, so it never replaces a session that is working.
 */
export function placeLaunch(slots: readonly Slot[], active: string, launch: TerminalLaunch, newKey: string): { slots: Slot[]; active: string } {
  const current = slots.find((slot) => slot.key === active);
  if (current && !current.terminalId && !current.launch) {
    return { slots: slots.map((slot) => (slot.key === active ? { ...slot, launch, adopt: undefined } : slot)), active };
  }
  return { slots: [...slots, { key: newKey, terminalId: null, launch }], active: newKey };
}
