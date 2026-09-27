/**
 * Keyboard decisions for the CLI terminal pane, kept free of xterm so they can
 * be tested directly.
 */

/**
 * What Shift+Enter sends to the PTY. xterm encodes Shift+Enter as the same
 * carriage return as Enter, so the harness submitted the prompt. A line feed
 * (the Ctrl+J byte) is the new-line key both Claude Code (2.1.283) and Codex
 * (0.157.1) accept in their prompt; bash treats it like Enter.
 */
export const SHIFT_ENTER_SEQUENCE = '\n';

/**
 * `suppress` swallows the keypress/keyup that follow a handled Shift+Enter:
 * xterm turns an unhandled Enter keypress into `\r`, which would submit anyway.
 */
export type TerminalKeyAction = 'copy' | 'paste' | 'newline' | 'suppress' | 'default';

type KeyEventLike = Pick<KeyboardEvent, 'type' | 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>;

/**
 * Decides how the terminal pane handles a keyboard event before xterm does.
 *
 * @param event        - The browser keyboard event.
 * @param hasSelection - Whether the terminal currently has selected text.
 */
export function terminalKeyAction(event: KeyEventLike, hasSelection: boolean): TerminalKeyAction {
  if (event.isComposing) return 'default';
  const key = event.key.toLowerCase();
  if (key === 'enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return event.type === 'keydown' ? 'newline' : 'suppress';
  }
  if (event.type !== 'keydown') return 'default';
  // A selected range behaves like selected browser text. Without a selection
  // Ctrl+C remains the terminal's interrupt key.
  if ((event.ctrlKey || event.metaKey) && key === 'c' && (event.shiftKey || hasSelection)) return 'copy';
  if ((event.ctrlKey || event.metaKey) && key === 'v') return 'paste';
  return 'default';
}
