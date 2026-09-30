import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findGrokSessions, getGrokTranscript, hasGrokSessions } from './grok-sessions.js';

let home: string;
let savedHome: string | undefined;

/** Build `~/.grok/sessions/<encoded-cwd>/<id>/` the way the CLI lays it out. */
async function seed(cwd: string, id: string, summary: Record<string, unknown> | null, history?: unknown[]) {
  const group = path.join(home, 'sessions', encodeURIComponent(cwd));
  const dir = path.join(group, id);
  await fs.mkdir(dir, { recursive: true });
  if (summary) await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary));
  if (history) {
    await fs.writeFile(
      path.join(dir, 'chat_history.jsonl'),
      history.map((message) => JSON.stringify(message)).join('\n') + '\n',
    );
  }
  return dir;
}

beforeEach(async () => {
  savedHome = process.env.GROK_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-home-'));
  process.env.GROK_HOME = home;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = savedHome;
  await fs.rm(home, { recursive: true, force: true });
});

const matches = (cwd: string) => (candidate: string) => candidate === cwd;

describe('Grok saved sessions', () => {
  it('lists sessions for a matching working directory', async () => {
    const cwd = '/home/dev/project';
    await seed(cwd, '0192abcd-0000-7000-8000-000000000001', {
      title: 'Refactor the loader',
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T11:00:00.000Z',
      messageCount: 6,
    });

    const sessions = await findGrokSessions([cwd], matches(cwd), (value) => value);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: '0192abcd-0000-7000-8000-000000000001',
      assistant: 'grok',
      title: 'Refactor the loader',
      messageCount: 6,
      recordedCwd: cwd,
    });
    expect(await hasGrokSessions([cwd], matches(cwd))).toBe(true);
  });

  it('ignores sessions recorded in another directory', async () => {
    const here = '/home/dev/project';
    await seed('/home/dev/other', '0192abcd-0000-7000-8000-000000000002', { title: 'Elsewhere' });
    expect(await findGrokSessions([here], matches(here), (value) => value)).toEqual([]);
    expect(await hasGrokSessions([here], matches(here))).toBe(false);
  });

  it('recovers the cwd from a .cwd header, which the encoded name cannot carry', async () => {
    // A long cwd is stored as a slug plus a hash; the real path lives in .cwd.
    const cwd = `/home/dev/${'a'.repeat(200)}/project`;
    const group = path.join(home, 'sessions', 'a-slug-and-a-hash');
    await fs.mkdir(path.join(group, '0192abcd-0000-7000-8000-000000000003'), { recursive: true });
    await fs.writeFile(path.join(group, '.cwd'), `${cwd}\n`);

    const sessions = await findGrokSessions([cwd], matches(cwd), (value) => value);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.recordedCwd).toBe(cwd);
  });

  it('reads the conversation from chat_history.jsonl', async () => {
    const cwd = '/home/dev/project';
    await seed(cwd, '0192abcd-0000-7000-8000-000000000004', { title: 'With history' }, [
      { role: 'user', content: 'add a test' },
      { role: 'assistant', content: 'added' },
    ]);

    const transcript = await getGrokTranscript('0192abcd-0000-7000-8000-000000000004');
    expect(transcript.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(transcript[1]!.content).toBe('added');
  });

  it('skips a malformed history line rather than failing the transcript', async () => {
    const cwd = '/home/dev/project';
    const dir = await seed(cwd, '0192abcd-0000-7000-8000-000000000005', { title: 'Broken' });
    await fs.writeFile(path.join(dir, 'chat_history.jsonl'), '{"role":"user","content":"ok"}\n{not json}\n');

    const transcript = await getGrokTranscript('0192abcd-0000-7000-8000-000000000005');
    expect(transcript).toHaveLength(1);
  });

  it('is empty when grok has never run', async () => {
    expect(await findGrokSessions(['/anywhere'], matches('/anywhere'), (value) => value)).toEqual([]);
    await expect(getGrokTranscript('nothing')).rejects.toThrow(/not found/);
  });
});
