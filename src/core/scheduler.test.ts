import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  addSchedule,
  formatInterval,
  isDue,
  loadSchedules,
  nextDueAt,
  parseInterval,
  removeSchedule,
  setScheduleEnabled,
  type ScheduledJob,
  type ScheduleStore,
} from './scheduler.js';

vi.mock('node:fs/promises');

/** Parses the JSON written by the most recent writeFile call. */
function lastWritten(): ScheduleStore {
  const calls = vi.mocked(fs.writeFile).mock.calls;
  const data = calls[calls.length - 1][1] as string;
  return JSON.parse(data) as ScheduleStore;
}

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'sync-ws-abc',
    workspacePath: '/ws',
    task: 'sync',
    intervalMinutes: 60,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
  });

  describe('parseInterval', () => {
    it('parses minutes, hours, days, and bare numbers', () => {
      expect(parseInterval('30m')).toBe(30);
      expect(parseInterval('2h')).toBe(120);
      expect(parseInterval('1d')).toBe(1440);
      expect(parseInterval('45')).toBe(45);
    });

    it('rejects invalid or non-positive input', () => {
      expect(parseInterval('')).toBeNull();
      expect(parseInterval('abc')).toBeNull();
      expect(parseInterval('0m')).toBeNull();
      expect(parseInterval('-5m')).toBeNull();
      expect(parseInterval('2w')).toBeNull();
    });
  });

  describe('formatInterval', () => {
    it('formats back to compact strings', () => {
      expect(formatInterval(30)).toBe('30m');
      expect(formatInterval(120)).toBe('2h');
      expect(formatInterval(1440)).toBe('1d');
      expect(formatInterval(90)).toBe('90m');
    });
  });

  describe('isDue', () => {
    it('is due when it has never run', () => {
      expect(isDue(makeJob())).toBe(true);
    });

    it('is not due when disabled, even if never run', () => {
      expect(isDue(makeJob({ enabled: false }))).toBe(false);
    });

    it('respects the interval since the last run', () => {
      const now = new Date('2026-01-02T12:00:00.000Z');
      const recent = makeJob({ lastRunAt: '2026-01-02T11:30:00.000Z' }); // 30m ago, every 60m
      const stale = makeJob({ lastRunAt: '2026-01-02T10:00:00.000Z' }); // 2h ago, every 60m

      expect(isDue(recent, now)).toBe(false);
      expect(isDue(stale, now)).toBe(true);
    });

    it('treats an unparseable lastRunAt as due', () => {
      expect(isDue(makeJob({ lastRunAt: 'garbage' }))).toBe(true);
    });
  });

  describe('nextDueAt', () => {
    it('is null for disabled jobs', () => {
      expect(nextDueAt(makeJob({ enabled: false }))).toBeNull();
    });

    it('is lastRunAt + interval for jobs that ran', () => {
      const job = makeJob({ lastRunAt: '2026-01-02T10:00:00.000Z' });
      expect(nextDueAt(job)!.toISOString()).toBe('2026-01-02T11:00:00.000Z');
    });
  });

  describe('store operations', () => {
    it('loadSchedules returns an empty store when the file is absent', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const store = await loadSchedules();

      expect(store.jobs).toEqual([]);
    });

    it('addSchedule persists a new enabled job', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const job = await addSchedule({ workspacePath: '/ws/feature-x', task: 'refresh', intervalMinutes: 120 });

      expect(job.enabled).toBe(true);
      expect(job.task).toBe('refresh');
      expect(job.id).toContain('refresh-feature-x');
      const written = lastWritten();
      expect(written.jobs).toHaveLength(1);
      expect(written.jobs[0]!.intervalMinutes).toBe(120);
    });

    it('removeSchedule deletes by id and reports misses', async () => {
      const existing: ScheduleStore = { version: 1, jobs: [makeJob()] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      expect(await removeSchedule('sync-ws-abc')).toBe(true);
      expect(lastWritten().jobs).toHaveLength(0);
      expect(await removeSchedule('nope')).toBe(false);
    });

    it('setScheduleEnabled toggles and persists', async () => {
      const existing: ScheduleStore = { version: 1, jobs: [makeJob()] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      const job = await setScheduleEnabled('sync-ws-abc', false);

      expect(job!.enabled).toBe(false);
      expect(lastWritten().jobs[0]!.enabled).toBe(false);
      expect(await setScheduleEnabled('nope', true)).toBeNull();
    });
  });
});
