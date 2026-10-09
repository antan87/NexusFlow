import { describe, expect, it } from 'vitest';
import { sessionToFocusAfterClose } from './sessionFocus.js';

describe('sessionToFocusAfterClose', () => {
  const tabs = ['alpha', 'beta', 'gamma'];

  it('goes to the session above the one closed', () => {
    expect(sessionToFocusAfterClose(tabs, 'beta')).toBe('alpha');
    expect(sessionToFocusAfterClose(tabs, 'gamma')).toBe('beta');
  });

  it('goes to the session below when the first one is closed', () => {
    expect(sessionToFocusAfterClose(tabs, 'alpha')).toBe('beta');
  });

  it('has nowhere to go when the last session is closed, or the one named is not open', () => {
    expect(sessionToFocusAfterClose(['alpha'], 'alpha')).toBeNull();
    expect(sessionToFocusAfterClose(tabs, 'delta')).toBeNull();
    expect(sessionToFocusAfterClose([], 'alpha')).toBeNull();
  });
});
