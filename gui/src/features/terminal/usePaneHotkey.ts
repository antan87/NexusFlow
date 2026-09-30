import { useEffect } from 'react';

/**
 * True when the event target is somewhere a keystroke belongs to: a text
 * field, a rich-text surface, or the xterm helper textarea that backs the PTY.
 *
 * The chat window hosts a real terminal, so bare letters must reach the shell.
 * Every panel shortcut is either modified, or is filtered through this guard.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // xterm keeps a real textarea offscreen for the caret and IME input.
  return target.classList.contains('xterm-helper-textarea') || target.closest('.xterm') !== null;
}

interface PaneHotkeyOptions {
  /** Ignore bare (unmodified) keys while the PTY owns the keyboard. Default true. */
  respectTerminal?: boolean;
  /** Only fire while the owning pane is the visible one. */
  enabled?: boolean;
}

/**
 * Registers a window-level hotkey handler for a chat panel.
 *
 * Bindings are matched explicitly rather than by guessing, so a panel can mix
 * modified keys (safe from anywhere, including inside the terminal) with bare
 * keys that are suppressed while the terminal has focus.
 */
export function usePaneHotkey(
  handler: (event: KeyboardEvent) => void,
  { respectTerminal = true, enabled = true }: PaneHotkeyOptions = {},
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (respectTerminal && !event.metaKey && !event.ctrlKey && !event.altKey && isTypingTarget(event.target)) {
        return;
      }
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, respectTerminal, enabled]);
}

/** True for the platform's primary modifier, optionally with Shift as well. */
export function hasModifier(event: KeyboardEvent, { shift = false } = {}): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.altKey) return false;
  return shift ? event.shiftKey : true;
}

/** Human-readable label for the current platform, for tooltips and hints. */
export const modifierLabel = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
