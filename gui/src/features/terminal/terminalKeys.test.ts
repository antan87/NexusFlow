import { describe, expect, it } from 'vitest';
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
});
