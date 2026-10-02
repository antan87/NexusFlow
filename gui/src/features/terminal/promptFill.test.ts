import { describe, expect, it } from 'vitest';

import { PROMPT_FILL_LIMIT, toPromptText } from './promptFill';

describe('toPromptText', () => {
  it('keeps ordinary text as it is', () => {
    expect(toPromptText('Continue with “Cache lookups” (api/cache.ts:42)')).toBe('Continue with “Cache lookups” (api/cache.ts:42)');
  });

  it('never lets a line break through, because a line break presses Enter', () => {
    for (const breaks of ['\r', '\n', '\r\n', '\u2028', '\u2029', '\u0085']) {
      const out = toPromptText(`first${breaks}second`);
      expect(out).toBe('first second');
      expect(out).not.toMatch(/[\r\n\u2028\u2029\u0085]/);
    }
  });

  it('removes escapes and control keys, so no control sequence or interrupt can be typed', () => {
    expect(toPromptText('a\u001b[201~b')).toBe('a [201~b');
    expect(toPromptText('stop\u0003now')).toBe('stop now');
    expect(toPromptText('x\u007fy')).toBe('x y');
    expect(toPromptText('a\u009bAb')).toBe('a Ab');
    expect(toPromptText('tab\there')).toBe('tab here');
    for (let code = 0; code < 32; code += 1) expect(toPromptText(`a${String.fromCharCode(code)}b`)).toMatch(/^a ?b$/);
  });

  it('removes invisible and direction-changing marks that can disguise text', () => {
    expect(toPromptText('rm\u202e -rf')).toBe('rm -rf');
    expect(toPromptText('a\u200bb\u2066c\ufeffd')).toBe('a b c d');
  });

  it('collapses whitespace and trims the ends', () => {
    expect(toPromptText('  a   b \n\n c  ')).toBe('a b c');
  });

  it('gives an empty string when nothing usable is left, so nothing is typed', () => {
    expect(toPromptText('')).toBe('');
    expect(toPromptText('   \r\n\t')).toBe('');
    expect(toPromptText('\u001b\u0003')).toBe('');
    expect(toPromptText(undefined)).toBe('');
    expect(toPromptText(42)).toBe('');
    expect(toPromptText(null)).toBe('');
    expect(toPromptText({ toString: () => 'x' })).toBe('');
  });

  it('keeps emoji and other non-Latin text', () => {
    expect(toPromptText('Fix the 🚀 launch — 日本語')).toBe('Fix the 🚀 launch — 日本語');
  });

  it('cuts long text at the limit without splitting an emoji', () => {
    const long = toPromptText('a'.repeat(PROMPT_FILL_LIMIT + 50));
    expect(long).toHaveLength(PROMPT_FILL_LIMIT);
    const emoji = toPromptText(`${'a'.repeat(PROMPT_FILL_LIMIT - 1)}🚀🚀`);
    expect(emoji.length).toBeLessThanOrEqual(PROMPT_FILL_LIMIT);
    expect(emoji).not.toMatch(/[\ud800-\udbff]$/);
    expect(emoji).toBe('a'.repeat(PROMPT_FILL_LIMIT - 1));
  });
});
