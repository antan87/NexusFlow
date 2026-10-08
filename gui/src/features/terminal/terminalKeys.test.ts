import { describe, expect, it } from 'vitest';
import { resolveWorkspaceShortcut } from '../workspace-shell/sessionShortcuts.js';
import { SHIFT_ENTER_SEQUENCE, terminalKeyAction } from './terminalKeys.js';

const key = (overrides: Partial<KeyboardEvent> & { key: string }) => ({
  type: 'keydown',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...overrides,
});

describe('terminal key handling', () => {
  it('turns Shift+Enter into a new line instead of a submit', () => {
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true }), false)).toBe('newline');
    expect(SHIFT_ENTER_SEQUENCE).toBe('\n');
  });

  it('leaves plain Enter and modified Enter to xterm', () => {
    expect(terminalKeyAction(key({ key: 'Enter' }), false)).toBe('default');
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true, ctrlKey: true }), false)).toBe('default');
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true, altKey: true }), false)).toBe('default');
  });

  it('does not act while an IME composition is open', () => {
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true, isComposing: true }), false)).toBe('default');
  });

  it('swallows the keypress and keyup of Shift+Enter so xterm cannot send a carriage return', () => {
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true, type: 'keypress' }), false)).toBe('suppress');
    expect(terminalKeyAction(key({ key: 'Enter', shiftKey: true, type: 'keyup' }), false)).toBe('suppress');
    expect(terminalKeyAction(key({ key: 'Enter', type: 'keypress' }), false)).toBe('default');
  });

  it('keeps Ctrl+C as interrupt without a selection and copy with one', () => {
    expect(terminalKeyAction(key({ key: 'c', ctrlKey: true }), false)).toBe('default');
    expect(terminalKeyAction(key({ key: 'c', ctrlKey: true }), true)).toBe('copy');
    expect(terminalKeyAction(key({ key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe('copy');
  });

  it('leaves paste to the browser paste event', () => {
    expect(terminalKeyAction(key({ key: 'v', ctrlKey: true }), false)).toBe('paste');
    expect(terminalKeyAction(key({ key: 'v', metaKey: true }), false)).toBe('paste');
  });

  describe('session keys', () => {
    const sessions = (openTabs: readonly string[], pathname = '/workspaces/alpha/chat') =>
      (event: Parameters<typeof terminalKeyAction>[0]) => resolveWorkspaceShortcut({ event, openTabs, activeTab: openTabs[0] ?? null, pathname }) !== null;
    const alt = (code: string, overrides: Partial<KeyboardEvent> & { key?: string } = {}) => key({ key: overrides.key ?? code, code, altKey: true, ...overrides });
    const open = ['alpha', 'beta', 'gamma'];

    it('keeps the session keys from the CLI while the app has somewhere to go', () => {
      const isAppKey = sessions(open);
      expect(terminalKeyAction(alt('ArrowDown'), false, isAppKey)).toBe('suppress');
      expect(terminalKeyAction(alt('ArrowUp'), false, isAppKey)).toBe('suppress');
      expect(terminalKeyAction(alt('Digit2', { key: '2' }), false, isAppKey)).toBe('suppress');
      // The keypress and keyup that follow are kept from xterm too.
      expect(terminalKeyAction(alt('Digit2', { key: '2', type: 'keyup' }), false, isAppKey)).toBe('suppress');
    });

    it('does so on a Mac, where Option+digit makes a symbol', () => {
      expect(terminalKeyAction(alt('Digit2', { key: '™' }), false, sessions(open))).toBe('suppress');
    });

    it('leaves Alt+Left/Right, Alt+[ ] and the other Alt keys to the CLI', () => {
      const isAppKey = sessions(open);
      for (const code of ['ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'KeyB', 'KeyF', 'Digit0']) {
        expect(terminalKeyAction(alt(code), false, isAppKey)).toBe('default');
      }
    });

    it('leaves a session key to the CLI when the app would not use it', () => {
      // One session: nothing to cycle to. Three sessions: no fourth slot to jump to.
      expect(terminalKeyAction(alt('ArrowDown'), false, sessions(['alpha']))).toBe('default');
      expect(terminalKeyAction(alt('Digit4', { key: '4' }), false, sessions(open))).toBe('default');
      expect(terminalKeyAction(alt('Digit1', { key: '1' }), false, sessions([]))).toBe('default');
    });

    it('does nothing about session keys when the caller does not say the app uses them', () => {
      expect(terminalKeyAction(alt('ArrowDown'), false)).toBe('default');
    });

    it('leaves Alt combinations with other modifiers to default', () => {
      const isAppKey = sessions(open);
      expect(terminalKeyAction(alt('Digit1', { key: '1', ctrlKey: true }), false, isAppKey)).toBe('default');
      expect(terminalKeyAction(alt('Digit1', { key: '1', metaKey: true }), false, isAppKey)).toBe('default');
    });
  });
});
