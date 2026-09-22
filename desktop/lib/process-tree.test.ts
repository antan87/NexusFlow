import { describe, expect, it } from 'vitest';
import { descendantPids } from './process-tree.js';
describe('desktop terminal teardown', () => {
  it('finds children of PTY session leaders before their parents and leaves unrelated processes alone', () => {
    const rows = '100 1\n101 100\n200 101\n201 200\n300 1\n301 300\n';
    expect(descendantPids(rows, 100)).toEqual([201, 200, 101]);
    expect(descendantPids(rows, 300)).toEqual([301]);
  });
});
