import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveWorkspaceChatLedger } from './constants.js';
import {
  SCREEN_CONTEXT_FILE,
  SCREEN_CONTEXT_STALE_MS,
  SCREEN_REVIEWED_LIMIT,
  SCREEN_SELECTION_LIMIT,
  SCREEN_SHARING_FILE,
  ScreenSharingOffError,
  getScreenSharing,
  readScreenContext,
  saveScreenContext,
  setScreenSharing,
} from './screen-context.js';

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
let dir: string;
let stateDir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-context-'));
  stateDir = (await resolveWorkspaceChatLedger(dir)).chatDir;
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

const contextFile = () => path.join(stateDir, SCREEN_CONTEXT_FILE);
const exists = (file: string) => fs.access(file).then(() => true, () => false);

describe('sharing is off until the user switches it on', () => {
  it('is off in a workspace that never mentioned it', async () => {
    expect(await getScreenSharing(dir)).toEqual({ enabled: false });
  });

  it('turns on and off, and remembers when', async () => {
    expect(await setScreenSharing(dir, true, NOW)).toEqual({ enabled: true, updatedAt: new Date(NOW).toISOString() });
    expect(await getScreenSharing(dir)).toEqual({ enabled: true, updatedAt: new Date(NOW).toISOString() });
    await setScreenSharing(dir, false, NOW + 1000);
    expect(await getScreenSharing(dir)).toEqual({ enabled: false });
  });

  it.each([['not json', 'garbage'], ['a string', '"on"'], ['enabled as text', '{"enabled":"true"}'], ['a number', '{"enabled":1}'], ['nothing', '{}']])('counts a setting file with %s as off', async (_n, content) => {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, SCREEN_SHARING_FILE), content);
    expect((await getScreenSharing(dir)).enabled).toBe(false);
  });

  it('leaves no half-written file behind', async () => {
    await setScreenSharing(dir, true, NOW);
    expect((await fs.readdir(stateDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('saveScreenContext', () => {
  it('refuses while sharing is off and stores nothing', async () => {
    await expect(saveScreenContext(dir, { viewing: { path: 'plan.md' } }, NOW)).rejects.toBeInstanceOf(ScreenSharingOffError);
    expect(await exists(contextFile())).toBe(false);
  });

  it('stores what the screen reports once sharing is on', async () => {
    await setScreenSharing(dir, true, NOW);
    const saved = await saveScreenContext(dir, { viewing: { path: 'src/a.ts', repo: 'NexusFlow', line: 12 }, selection: 'const x = 1;', reviewed: ['plan.md'] }, NOW);
    expect(saved).toEqual({ viewing: { path: 'src/a.ts', repo: 'NexusFlow', line: 12 }, selection: 'const x = 1;', reviewed: ['plan.md'], updatedAt: new Date(NOW).toISOString() });
    expect(JSON.parse(await fs.readFile(contextFile(), 'utf8'))).toEqual(saved);
  });

  it('cleans everything it is given, so the screen cannot smuggle in a path, an escape code or a huge selection', async () => {
    await setScreenSharing(dir, true, NOW);
    const saved = await saveScreenContext(dir, {
      viewing: { path: '/etc/passwd', repo: 'a/b', line: -4 },
      selection: 'line one\r\nline two\u0007\u001b[31m' + 'x'.repeat(5000),
      reviewed: ['a.ts', 'a.ts', '../x', '/etc/hosts', '.git/config', 7, 'b.ts'] as unknown[],
    }, NOW);
    expect(saved.viewing).toBeUndefined();
    expect(saved.selection!.startsWith('line one\nline two[31m')).toBe(true);
    expect(saved.selection).toHaveLength(SCREEN_SELECTION_LIMIT);
    expect(saved.selection).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect(saved.reviewed).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps only the newest reviewed files when there are too many', async () => {
    await setScreenSharing(dir, true, NOW);
    const reviewed = Array.from({ length: SCREEN_REVIEWED_LIMIT + 5 }, (_, i) => `f${i}.ts`);
    const saved = await saveScreenContext(dir, { reviewed }, NOW);
    expect(saved.reviewed).toHaveLength(SCREEN_REVIEWED_LIMIT);
    expect(saved.reviewed.at(-1)).toBe(`f${SCREEN_REVIEWED_LIMIT + 4}.ts`);
  });

  it.each([null, undefined, 'plan.md', 7, []])('copes with a report that is %j', async (input) => {
    await setScreenSharing(dir, true, NOW);
    const saved = await saveScreenContext(dir, input as never, NOW);
    expect(saved).toEqual({ reviewed: [], updatedAt: new Date(NOW).toISOString() });
  });

  it('replaces the previous view instead of adding to it', async () => {
    await setScreenSharing(dir, true, NOW);
    await saveScreenContext(dir, { viewing: { path: 'a.ts' }, selection: 'old' }, NOW);
    await saveScreenContext(dir, { viewing: { path: 'b.ts' } }, NOW + 1000);
    const stored = JSON.parse(await fs.readFile(contextFile(), 'utf8'));
    expect(stored.viewing.path).toBe('b.ts');
    expect(stored).not.toHaveProperty('selection');
  });
});

describe('switching sharing off', () => {
  it('deletes the stored view', async () => {
    await setScreenSharing(dir, true, NOW);
    await saveScreenContext(dir, { viewing: { path: 'plan.md' }, selection: 'private' }, NOW);
    expect(await exists(contextFile())).toBe(true);
    await setScreenSharing(dir, false, NOW + 1000);
    expect(await exists(contextFile())).toBe(false);
  });

  it('is fine when there is nothing to delete', async () => {
    await expect(setScreenSharing(dir, false, NOW)).resolves.toMatchObject({ enabled: false });
  });
});

describe('readScreenContext, the AI asking what the user is looking at', () => {
  it('learns only that sharing is off, and is told to ask in the chat', async () => {
    const answer = await readScreenContext(dir, NOW);
    expect(answer).toMatchObject({ shared: false });
    expect(JSON.stringify(answer)).toContain('Ask them in the chat');
  });

  it('never reads a stored view while sharing is off, even if a file is left over', async () => {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(contextFile(), JSON.stringify({ viewing: { path: 'secret.md' }, selection: 'private', reviewed: [], updatedAt: new Date(NOW).toISOString() }));
    const answer = await readScreenContext(dir, NOW);
    expect(answer).toEqual({ shared: false, message: expect.any(String) });
    expect(JSON.stringify(answer)).not.toContain('secret');
    expect(JSON.stringify(answer)).not.toContain('private');
  });

  it('says so when sharing is on but the screen has reported nothing yet', async () => {
    await setScreenSharing(dir, true, NOW);
    expect(await readScreenContext(dir, NOW)).toMatchObject({ shared: true, context: null, message: expect.stringContaining('not reported') });
  });

  it('returns the view with how old it is', async () => {
    await setScreenSharing(dir, true, NOW);
    await saveScreenContext(dir, { viewing: { path: 'plan.md', line: 3 } }, NOW);
    const answer = await readScreenContext(dir, NOW + 45_000);
    expect(answer).toMatchObject({ shared: true, ageSeconds: 45, context: { viewing: { path: 'plan.md', line: 3 } } });
    expect(answer).not.toHaveProperty('stale');
  });

  it('marks a view older than ten minutes as stale', async () => {
    await setScreenSharing(dir, true, NOW);
    await saveScreenContext(dir, { viewing: { path: 'plan.md' } }, NOW);
    expect(await readScreenContext(dir, NOW + SCREEN_CONTEXT_STALE_MS + 1000)).toMatchObject({ shared: true, stale: true, message: expect.stringContaining('ten minutes') });
  });

  it('cleans the stored file again when reading, so a hand-edited file cannot inject anything', async () => {
    await setScreenSharing(dir, true, NOW);
    await fs.writeFile(contextFile(), JSON.stringify({ viewing: { path: '/etc/passwd' }, selection: 'x\u0007y', reviewed: ['../a', 'ok.ts'], updatedAt: new Date(NOW).toISOString(), extra: 'dropped' }));
    const answer = await readScreenContext(dir, NOW);
    expect(answer).toMatchObject({ shared: true, context: { selection: 'xy', reviewed: ['ok.ts'] } });
    expect((answer as { context: Record<string, unknown> }).context).not.toHaveProperty('viewing');
    expect((answer as { context: Record<string, unknown> }).context).not.toHaveProperty('extra');
  });

  it.each([['not json', 'garbage'], ['no timestamp', '{"viewing":{"path":"a"}}'], ['a bad timestamp', '{"updatedAt":"yesterday"}']])('treats a stored view with %s as nothing reported', async (_n, content) => {
    await setScreenSharing(dir, true, NOW);
    await fs.writeFile(contextFile(), content);
    expect(await readScreenContext(dir, NOW)).toMatchObject({ shared: true, context: null });
  });
});
