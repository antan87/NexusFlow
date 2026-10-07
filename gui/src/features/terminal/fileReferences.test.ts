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

  it('strips angle brackets and ignores angle-wrapped URLs', () => {
    const found = findFileReferences('check <src/app.ts:15> and <https://example.com/docs> and <http://localhost:3000>');
    expect(found.map(({ text, path, line }) => ({ text, path, line }))).toEqual([
      { text: 'src/app.ts:15', path: 'src/app.ts', line: 15 },
    ]);
  });

  it('strips markdown link syntax and ignores markdown web links', () => {
    const found = findFileReferences('refer to [guide](src/guide.md:20) and [docs](https://example.com) and [repo](github.com/foo/bar)');
    expect(found.map(({ text, path, line }) => ({ text, path, line }))).toEqual([
      { text: 'src/guide.md:20', path: 'src/guide.md', line: 20 },
    ]);
  });

  it('handles angle-wrapped URLs inside markdown link syntax', () => {
    const found = findFileReferences('see [source](<src/components/Header.tsx:42>) and [link](<https://foo.com>)');
    expect(found.map(({ text, path, line }) => ({ text, path, line }))).toEqual([
      { text: 'src/components/Header.tsx:42', path: 'src/components/Header.tsx', line: 42 },
    ]);
  });

  it('filters out web domains, localhost, IPs, and mailto', () => {
    const found = findFileReferences('links: github.com/mrpatronz/nexusflow example.com:8080 localhost:3000/api 127.0.0.1:8080/index.html mailto:dev@example.com README.md:5');
    expect(found.map(({ path, line }) => ({ path, line }))).toEqual([
      { path: 'README.md', line: 5 },
    ]);
  });
});
