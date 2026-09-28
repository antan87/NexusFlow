/**
 * Percentiles use the nearest-rank method: p95 of n samples is the value at
 * rank ceil(0.95 * n). It is reported only with at least 20 samples, where it
 * is not simply the maximum.
 */
export const MIN_SAMPLES_FOR_P95 = 20;

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarize(samples) {
  const values = samples.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    n: values.length,
    p50: round(percentile(values, 50)),
    p95: values.length >= MIN_SAMPLES_FOR_P95 ? round(percentile(values, 95)) : null,
    max: round(values.at(-1) ?? null),
    min: round(values[0] ?? null),
  };
}

/**
 * Compares summaries with budgets. A metric fails when its p95 (or p50 when
 * the budget sets only p50) exceeds the budget by more than `tolerance`.
 */
export function compareBudgets(summaries, budgets, tolerance = 0.1) {
  const rows = [];
  for (const [metric, budget] of Object.entries(budgets)) {
    const s = summaries[metric];
    for (const stat of ['p50', 'p95', 'max']) {
      if (budget[stat] === undefined) continue;
      const observed = s?.[stat] ?? null;
      const limit = budget[stat] * (1 + tolerance);
      rows.push({
        metric, stat, budget: budget[stat], limit: Math.round(limit), observed,
        verdict: observed === null ? 'missing' : observed <= limit ? 'pass' : 'fail',
      });
    }
  }
  return rows;
}
