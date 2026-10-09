import { describe, expect, it } from 'vitest';
import {
  cycleKeysLabel,
  isFormInput,
  jumpKeyLabel,
  resolveWorkspaceShortcut,
  sessionKeyOf,
  sessionModifierName,
  type SessionKeyEvent,
} from './sessionShortcuts.js';

const tabs = ['alpha', 'beta', 'gamma'] as const;

/** An Alt key event the way a browser reports it: the physical key in `code`, the character it makes in `key`. */
const alt = (code: string, overrides: Partial<SessionKeyEvent> & { key?: string } = {}): SessionKeyEvent => ({
  key: overrides.key ?? code,
  code,
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

const resolve = (event: SessionKeyEvent & { target?: unknown; defaultPrevented?: boolean }, pathname: string, activeTab: string | null = 'alpha', openTabs: readonly string[] = tabs) =>
  resolveWorkspaceShortcut({ event, openTabs, activeTab, pathname });

describe('isFormInput', () => {
  it('returns false for null or primitive targets', () => {
    expect(isFormInput(null)).toBe(false);
    expect(isFormInput(undefined)).toBe(false);
    expect(isFormInput('string')).toBe(false);
  });

  it('returns true for inputs, regular textareas, selects and contenteditable elements', () => {
    expect(isFormInput({ tagName: 'INPUT' })).toBe(true);
    expect(isFormInput({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isFormInput({ tagName: 'SELECT' })).toBe(true);
    expect(isFormInput({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('returns false for the xterm helper textarea and anything inside .xterm', () => {
    expect(isFormInput({ tagName: 'TEXTAREA', classList: { contains: (cls: string) => cls === 'xterm-helper-textarea' } })).toBe(false);
    expect(isFormInput({ tagName: 'DIV', closest: (selector: string) => (selector === '.xterm' ? {} : null) })).toBe(false);
  });
});

describe('sessionKeyOf', () => {
  it('names Alt+Up and Alt+Down as cycling and Alt+1..9 as jumping to that slot', () => {
    expect(sessionKeyOf(alt('ArrowDown'))).toEqual({ kind: 'cycle', step: 1 });
    expect(sessionKeyOf(alt('ArrowUp'))).toEqual({ kind: 'cycle', step: -1 });
    for (let slot = 1; slot <= 9; slot++) {
      expect(sessionKeyOf(alt(`Digit${slot}`, { key: String(slot) }))).toEqual({ kind: 'jump', index: slot - 1 });
    }
  });

  it('reads Option+digit on a Mac by the physical key, whatever character it makes', () => {
    // US Mac layout: Option+1 types the inverted exclamation mark, Option+2 the trade mark sign.
    expect(sessionKeyOf(alt('Digit1', { key: '¡' }))).toEqual({ kind: 'jump', index: 0 });
    expect(sessionKeyOf(alt('Digit2', { key: '™' }))).toEqual({ kind: 'jump', index: 1 });
    expect(sessionKeyOf(alt('Digit9', { key: 'ª' }))).toEqual({ kind: 'jump', index: 8 });
  });

  it('reads the physical key on layouts where the digit needs Shift', () => {
    // French layout: the 1 key makes '&' without Shift.
    expect(sessionKeyOf(alt('Digit1', { key: '&' }))).toEqual({ kind: 'jump', index: 0 });
  });

  it('leaves the keys that belong to shells, TUIs and the OS alone', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Tab', 'Digit0', 'KeyB', 'KeyF']) {
      expect(sessionKeyOf(alt(code))).toBeNull();
    }
    expect(sessionKeyOf(alt('Numpad1', { key: '1' }))).toBeNull();
  });

  it('needs a bare Alt: Ctrl (which is also AltGr), Meta, Shift or no Alt at all is not a session key', () => {
    expect(sessionKeyOf(alt('Digit1', { ctrlKey: true }))).toBeNull();
    expect(sessionKeyOf(alt('Digit1', { metaKey: true }))).toBeNull();
    expect(sessionKeyOf(alt('Digit1', { shiftKey: true }))).toBeNull();
    expect(sessionKeyOf(alt('ArrowDown', { shiftKey: true }))).toBeNull();
    expect(sessionKeyOf(alt('Digit1', { altKey: false }))).toBeNull();
  });

  it('falls back to the character for an event that does not name its physical key', () => {
    const synthetic = (key: string): SessionKeyEvent => ({ key, altKey: true, ctrlKey: false, metaKey: false });
    expect(sessionKeyOf(synthetic('3'))).toEqual({ kind: 'jump', index: 2 });
    expect(sessionKeyOf(synthetic('ArrowDown'))).toEqual({ kind: 'cycle', step: 1 });
    expect(sessionKeyOf(synthetic('Up'))).toEqual({ kind: 'cycle', step: -1 });
    expect(sessionKeyOf(synthetic('ArrowLeft'))).toBeNull();
    expect(sessionKeyOf(synthetic('['))).toBeNull();
    expect(sessionKeyOf(synthetic('0'))).toBeNull();
  });
});

describe('resolveWorkspaceShortcut', () => {
  it('returns null when the event was already handled, or is not a session key', () => {
    expect(resolve(alt('Digit2', { key: '2' }), '/workspaces/alpha/plan', 'alpha')).not.toBeNull();
    expect(resolve({ ...alt('Digit1', { key: '1' }), defaultPrevented: true }, '/workspaces/alpha/plan')).toBeNull();
    expect(resolve(alt('KeyA', { key: 'a' }), '/workspaces/alpha/plan')).toBeNull();
    expect(resolve(alt('Digit1', { key: '1', ctrlKey: true }), '/workspaces/alpha/plan')).toBeNull();
  });

  it('returns null when no session is open', () => {
    expect(resolve(alt('Digit1', { key: '1' }), '/workspaces/alpha', null, [])).toBeNull();
    expect(resolve(alt('ArrowDown'), '/workspaces/alpha', null, [])).toBeNull();
  });

  it('jumps to the slot with Alt+1..9 and keeps the section being read', () => {
    expect(resolve(alt('Digit1', { key: '1' }), '/workspaces/gamma/plan', 'gamma')).toEqual({ targetBranch: 'alpha', targetSection: 'plan' });
    expect(resolve(alt('Digit2', { key: '2' }), '/workspaces/alpha/changes')).toEqual({ targetBranch: 'beta', targetSection: 'changes' });
    expect(resolve(alt('Digit3', { key: '3' }), '/workspaces/alpha/chat')).toEqual({ targetBranch: 'gamma', targetSection: 'chat' });
  });

  it('jumps on a Mac, where Option+digit makes a symbol', () => {
    expect(resolve(alt('Digit2', { key: '™' }), '/workspaces/alpha/plan')).toEqual({ targetBranch: 'beta', targetSection: 'plan' });
  });

  it('does not take a jump to the session already on screen, so the key reaches the CLI', () => {
    expect(resolve(alt('Digit1', { key: '1' }), '/workspaces/alpha/chat')).toBeNull();
    expect(resolve(alt('Digit2', { key: '2' }), '/workspaces/beta/plan', 'beta')).toBeNull();
    // From a page that is not a workspace the same key is the way back to it.
    expect(resolve(alt('Digit1', { key: '1' }), '/overview', 'alpha')).toEqual({ targetBranch: 'alpha', targetSection: 'chat' });
  });

  it('does nothing for a slot that is not open', () => {
    expect(resolve(alt('Digit4', { key: '4' }), '/workspaces/alpha')).toBeNull();
    expect(resolve(alt('Digit9', { key: '9' }), '/workspaces/alpha')).toBeNull();
  });

  it('cycles down and up through the open sessions and wraps round', () => {
    expect(resolve(alt('ArrowDown'), '/workspaces/alpha/plan')).toEqual({ targetBranch: 'beta', targetSection: 'plan' });
    expect(resolve(alt('ArrowDown'), '/workspaces/beta/changes', 'beta')).toEqual({ targetBranch: 'gamma', targetSection: 'changes' });
    expect(resolve(alt('ArrowDown'), '/workspaces/gamma/documents', 'gamma')).toEqual({ targetBranch: 'alpha', targetSection: 'documents' });
    expect(resolve(alt('ArrowUp'), '/workspaces/beta/skills', 'beta')).toEqual({ targetBranch: 'alpha', targetSection: 'skills' });
    expect(resolve(alt('ArrowUp'), '/workspaces/alpha/changes')).toEqual({ targetBranch: 'gamma', targetSection: 'changes' });
  });

  it('does not use Alt+Left/Right, Alt+[ ] or Alt+Tab, so the CLI and the OS keep them', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight', 'Tab']) {
      expect(resolve(alt(code), '/workspaces/beta/chat', 'beta')).toBeNull();
    }
  });

  it('enters the open sessions from a workspace that is not one of them', () => {
    expect(resolve(alt('ArrowDown'), '/workspaces/delta/plan', 'delta')).toEqual({ targetBranch: 'alpha', targetSection: 'plan' });
    expect(resolve(alt('ArrowUp'), '/workspaces/delta/plan', 'delta')).toEqual({ targetBranch: 'gamma', targetSection: 'plan' });
  });

  it('does not cycle when there is no other session to go to, so the key reaches the CLI', () => {
    expect(resolve(alt('ArrowDown'), '/workspaces/solo', 'solo', ['solo'])).toBeNull();
    expect(resolve(alt('ArrowUp'), '/workspaces/solo', 'solo', ['solo'])).toBeNull();
    // Entering the only session from somewhere else is still a move.
    expect(resolve(alt('ArrowDown'), '/overview', 'solo', ['solo'])).toEqual({ targetBranch: 'solo', targetSection: 'chat' });
  });

  it('defaults the section to the chat outside a workspace page', () => {
    expect(resolve(alt('Digit2', { key: '2' }), '/overview')).toEqual({ targetBranch: 'beta', targetSection: 'chat' });
  });

  it('ignores the shortcut while typing in a form field', () => {
    expect(resolve({ ...alt('Digit1', { key: '1' }), target: { tagName: 'INPUT' } }, '/workspaces/beta/plan', 'beta')).toBeNull();
  });

  it('allows the shortcut from the xterm helper textarea', () => {
    const xterm = { tagName: 'TEXTAREA', classList: { contains: (cls: string) => cls === 'xterm-helper-textarea' } };
    expect(resolve({ ...alt('Digit2', { key: '2' }), target: xterm }, '/workspaces/alpha/chat')).toEqual({ targetBranch: 'beta', targetSection: 'chat' });
  });
});

describe('shortcut labels', () => {
  it('say Alt on Windows and Linux and Option on a Mac', () => {
    expect(sessionModifierName(false)).toBe('Alt');
    expect(sessionModifierName(true)).toBe('Option');
    expect(jumpKeyLabel(3, false)).toBe('Alt+3');
    expect(jumpKeyLabel(3, true)).toBe('⌥3');
    expect(cycleKeysLabel(false)).toBe('Alt+↓/↑');
    expect(cycleKeysLabel(true)).toBe('⌥↓/↑');
  });
});
