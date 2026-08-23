import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html.js';

describe('desktop escapeHtml helper', () => {
  it('escapes special HTML characters', () => {
    expect(escapeHtml('<img>')).toBe('&lt;img&gt;');
    expect(escapeHtml('alert("xss") & \'test\'')).toBe('alert(&quot;xss&quot;) &amp; &#039;test&#039;');
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });

  it('handles ampersand first to avoid double escaping', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});
