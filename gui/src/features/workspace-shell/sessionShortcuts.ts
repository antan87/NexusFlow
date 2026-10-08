import { parseWorkspacePath } from '../chat/chatRoute.js';

/**
 * The keys that move between open workspace sessions, decided in one place so the window and the terminal agree.
 * Only Alt+Up/Down (cycle) and Alt+1..9 (jump) are used. Alt+Left/Right is word movement in shells and TUIs, Alt+[ sends
 * the escape that starts every control sequence, and Alt+Tab belongs to the OS, so none of those are taken.
 */

export function isFormInput(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  if (typeof HTMLElement !== 'undefined' && !(target instanceof HTMLElement)) {
    return false;
  }
  const el = target as {
    classList?: { contains(name: string): boolean };
    closest?: (selector: string) => unknown;
    isContentEditable?: boolean;
    tagName?: string;
  };
  if (el.classList?.contains?.('xterm-helper-textarea') || el.closest?.('.xterm')) {
    return false;
  }
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface SessionKeyEvent {
  key: string;
  /** The physical key. Option+1 on a Mac has the key '¡' but the code 'Digit1', so the code is what names the key. */
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
}

export type SessionKey = { kind: 'cycle'; step: 1 | -1 } | { kind: 'jump'; index: number };

/** Which session key this event is, if any. Only a bare Alt counts: Ctrl (also AltGr), Meta and Shift leave it alone. */
export function sessionKeyOf(event: SessionKeyEvent): SessionKey | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const code = event.code ?? '';
  if (code === 'ArrowDown') return { kind: 'cycle', step: 1 };
  if (code === 'ArrowUp') return { kind: 'cycle', step: -1 };
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) return { kind: 'jump', index: Number(digit[1]) - 1 };
  // Numpad keys and every other physical key are not session keys.
  if (code !== '') return null;
  // An event that does not say which physical key it was (a synthetic one) is read by its character.
  const key = event.key.toLowerCase();
  if (key === 'arrowdown' || key === 'down') return { kind: 'cycle', step: 1 };
  if (key === 'arrowup' || key === 'up') return { kind: 'cycle', step: -1 };
  if (/^[1-9]$/.test(key)) return { kind: 'jump', index: Number(key) - 1 };
  return null;
}

export interface ResolveShortcutParams {
  event: SessionKeyEvent & {
    defaultPrevented?: boolean;
    target?: unknown;
  };
  openTabs: readonly string[];
  activeTab: string | null;
  pathname: string;
}

export interface ResolvedShortcut {
  targetBranch: string;
  targetSection: string;
}

/**
 * Pure decision for the global session shortcuts: the session an event moves to, or null when the app does not use it.
 * Alt+Up/Down cycle through the open sessions and wrap; Alt+1..9 jump to that slot. The section being read is kept.
 * A key is only used when it does something: cycling needs another session to go to, jumping needs that slot to be open.
 * The terminal asks this same question, so a key the app does not use reaches the CLI.
 */
export function resolveWorkspaceShortcut({
  event,
  openTabs,
  activeTab,
  pathname,
}: ResolveShortcutParams): ResolvedShortcut | null {
  if (event.defaultPrevented) return null;
  if (isFormInput(event.target ?? null)) return null;
  const shortcut = sessionKeyOf(event);
  if (!shortcut || openTabs.length === 0) return null;

  const parsed = parseWorkspacePath(pathname);
  const currentBranch = parsed?.workspace ?? activeTab ?? openTabs[0]!;
  const currentIndex = openTabs.indexOf(currentBranch);

  let targetBranch: string | null | undefined;
  if (shortcut.kind === 'jump') {
    targetBranch = openTabs[shortcut.index];
    // Already on that workspace's page: nothing to do, so the key is not taken from the CLI.
    if (targetBranch === currentBranch && parsed) return null;
  } else if (currentIndex === -1) {
    // Not on an open session (the overview, a closed chat): the first or last session is the way in.
    targetBranch = shortcut.step === 1 ? openTabs[0] : openTabs[openTabs.length - 1];
  } else if (openTabs.length > 1 || !parsed) {
    // With one session there is nowhere to cycle to from its own page, but from any other page it is the way back.
    targetBranch = openTabs[(currentIndex + shortcut.step + openTabs.length) % openTabs.length];
  }

  if (!targetBranch) return null;
  return { targetBranch, targetSection: parsed?.section ?? 'chat' };
}

/** Option on a Mac, Alt everywhere else. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

/** The modifier's name for titles and screen readers. */
export const sessionModifierName = (apple = isApplePlatform()) => (apple ? 'Option' : 'Alt');

/** Compact label for a session's jump key, for the badge on its row. */
export const jumpKeyLabel = (slot: number, apple = isApplePlatform()) => (apple ? `⌥${slot}` : `Alt+${slot}`);

/** Compact label for the cycle keys. */
export const cycleKeysLabel = (apple = isApplePlatform()) => (apple ? '⌥↓/↑' : 'Alt+↓/↑');
