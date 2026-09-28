import { describe, expect, it } from 'vitest';

import { compareBudgets, percentile, summarize } from './stats.mjs';

describe('perf statistics', () => {
  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 95)).toBe(19); // rank ceil(19) — not simply the max
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it('reports p95 only with at least 20 samples and ignores missing values', () => {
    expect(summarize([3, 1, 2, null, Number.NaN])).toEqual({ n: 3, p50: 2, p95: null, max: 3, min: 1 });
    expect(summarize(Array.from({ length: 20 }, (_, i) => 20 - i)).p95).toBe(19);
  });

  it('passes within the tolerance and flags missing metrics', () => {
    const summaries = { 'S1.usable': { n: 20, p50: 2000, p95: 3250, max: 3400, min: 1800 } };
    const rows = compareBudgets(summaries, { 'S1.usable': { p95: 3000 }, 'S3.ready': { p95: 500 } }, 0.1);

    expect(rows).toEqual([
      { metric: 'S1.usable', stat: 'p95', budget: 3000, limit: 3300, observed: 3250, verdict: 'pass' },
      { metric: 'S3.ready', stat: 'p95', budget: 500, limit: 550, observed: null, verdict: 'missing' },
    ]);
    expect(compareBudgets(summaries, { 'S1.usable': { p95: 2900 } }, 0.1)[0].verdict).toBe('fail');
  });
});
