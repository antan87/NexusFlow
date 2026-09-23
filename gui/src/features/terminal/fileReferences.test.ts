import { describe, expect, it } from 'vitest';
import { findFileReferences } from './fileReferences.js';

describe('terminal file references', () => {
  it('keeps quoted paths with spaces together and ignores URLs', () => {
    const found = findFileReferences('at ("src/my file.ts:12") https://example.com/file.ts src/next.ts:7:3');
    expect(found.map(({ path, line }) => ({ path, line }))).toEqual([
      { path: 'src/my file.ts', line: 12 },
      { path: 'src/next.ts', line: 7 },
    ]);
  });

  it('recognizes parenthesized locations and does not link quoted fragments', () => {
    expect(findFileReferences("'src/other file.ts(42,3)'"))
      .toEqual([{ text: 'src/other file.ts(42,3)', path: 'src/other file.ts', line: 42, start: 1, end: 24 }]);
  });

  it('handles contractions, a suffix after the closing quote, and backtick paths', () => {
    const found = findFileReferences("I've updated src/next.ts:7 and `src/my file.ts`:12 plus \"src/other file.ts\":3");
    expect(found.map(({ path, line }) => ({ path, line }))).toEqual([
      { path: 'src/next.ts', line: 7 },
      { path: 'src/my file.ts', line: 12 },
      { path: 'src/other file.ts', line: 3 },
    ]);
  });
});
