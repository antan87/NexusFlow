import { describe, expect, it } from 'vitest';
import * as path from 'node:path';

import {
  countRequest,
  installPerfCounters,
  perfCountersEnabled,
  readBucket,
  resetPerfCounters,
  snapshotPerfCounters,
} from './perf-counters.js';

describe('perf counters', () => {
  it('stays off unless the flag is exactly "1"', () => {
    expect(perfCountersEnabled({})).toBe(false);
    expect(perfCountersEnabled({ CONTEXTSPACE_PERF_COUNTERS: 'true' })).toBe(false);
    expect(perfCountersEnabled({ CONTEXTSPACE_PERF_COUNTERS: '1' })).toBe(true);
    // Installing without the flag must not patch any builtin.
    expect(installPerfCounters({})).toBe(false);
  });

  it('groups reads by the history source they belong to', () => {
    const home = path.resolve('/home/dev');
    expect(readBucket(path.join(home, '.claude', 'projects', 'x', 'a.jsonl'), home)).toBe('claude');
    expect(readBucket(path.join(home, '.codex', 'sessions', '2026', 'r.jsonl'), home)).toBe('codex');
    expect(readBucket(path.join(home, '.contextspace', 'config.json'), home)).toBe('config');
    expect(readBucket(path.join(home, '.claudeish', 'file'), home)).toBe('other');
    expect(readBucket(path.resolve('/srv/repo/file.ts'), home)).toBe('other');
  });

  it('counts requests and aborts, including aborts that arrive after a reset', () => {
    resetPerfCounters();
    const controller = new AbortController();
    countRequest('GET', '/api/workspaces', controller.signal);
    countRequest('GET', '/api/workspaces');
    expect(snapshotPerfCounters().requests['GET /api/workspaces']).toEqual({ count: 2, aborted: 0 });

    resetPerfCounters();
    controller.abort();
    expect(snapshotPerfCounters().requests['GET /api/workspaces']).toEqual({ count: 0, aborted: 1 });
  });

  it('returns snapshots that later counting does not change', () => {
    resetPerfCounters();
    countRequest('GET', '/api/config');
    const before = snapshotPerfCounters();
    countRequest('GET', '/api/config');
    expect(before.requests['GET /api/config']?.count).toBe(1);
  });
});
