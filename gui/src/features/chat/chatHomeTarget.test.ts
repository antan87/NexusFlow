import { describe, expect, it } from 'vitest';

import { chatHomeTarget } from './chatHomeTarget';

describe('chatHomeTarget', () => {
  it('is the chat in front', () => {
    expect(chatHomeTarget('beta', ['alpha', 'beta'], ['alpha', 'beta', 'gamma'])).toBe('beta');
  });

  it('falls back to another open chat when the one in front is gone', () => {
    expect(chatHomeTarget('removed', ['gone', 'alpha'], ['alpha', 'gamma'])).toBe('alpha');
    expect(chatHomeTarget(null, ['alpha', 'beta'], ['beta'])).toBe('beta');
  });

  it('is null when no chat was open, or none of them still exist, so the app opens on the overview', () => {
    expect(chatHomeTarget(null, [], ['alpha'])).toBeNull();
    expect(chatHomeTarget('gone', ['gone', 'also-gone'], ['alpha'])).toBeNull();
    expect(chatHomeTarget('alpha', ['alpha'], [])).toBeNull();
  });
});
