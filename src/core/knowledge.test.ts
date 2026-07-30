import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  insertUnderHeading,
  formatEntry,
  parseKnowledgeEntries,
  addWorkspaceKnowledge,
  addBaseKnowledge,
  promoteKnowledge,
  readWorkspaceKnowledge,
} from './knowledge.js';
import * as storage from './storage.js';
import * as workspace from './workspace.js';
import * as generators from '../generators/index.js';

vi.mock('./storage.js');
vi.mock('./workspace.js');
vi.mock('../generators/index.js');

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe('insertUnderHeading', () => {
  it('inserts under an existing heading and strips the placeholder', () => {
    const md = `## Known Gotchas\n\n<!-- keep me -->\n\n_(No gotchas recorded yet.)_\n`;
    const out = insertUnderHeading(md, ['Known Gotchas'], '- **2026-07-04:** watch the cache');

    expect(out).toContain('- **2026-07-04:** watch the cache');
    expect(out).not.toContain('No gotchas recorded yet');
    expect(out).toContain('<!-- keep me -->'); // comments are preserved
  });

  it('matches a heading via an alias', () => {
    const md = `## Discovered Gotchas & Watch-outs\n\n- None recorded yet.\n`;
    const out = insertUnderHeading(
      md,
      ['Discovered Gotchas & Watch-outs', 'Known Gotchas'],
      '- **2026-07-04:** x',
    );
    expect(out).toContain('- **2026-07-04:** x');
    expect(out).not.toContain('None recorded yet');
  });

  it('appends a new section when the heading is missing', () => {
    const md = `# Workspace Knowledge — feat\n`;
    const out = insertUnderHeading(
      md,
      ['Architecture Decisions'],
      '### 2026-07-04 — Chose X\n**Decision:** because reasons',
    );
    expect(out).toContain('## Architecture Decisions');
    expect(out).toContain('**Decision:** because reasons');
  });

  it('preserves CRLF line endings', () => {
    const md = `## Known Gotchas\r\n\r\n_(No gotchas recorded yet.)_\r\n`;
    const out = insertUnderHeading(md, ['Known Gotchas'], '- foo');
    expect(out.includes('\r\n')).toBe(true);
    // No bare LF (every \n must be preceded by \r).
    expect(/[^\r]\n/.test(out)).toBe(false);
  });

  it('passes through a leading YAML frontmatter block', () => {
    const md = `---\ntags: ["x"]\ntype: workspace-context\n---\n\n## Known Gotchas\n\n_(No gotchas recorded yet.)_\n`;
    const out = insertUnderHeading(md, ['Known Gotchas'], '- foo');
    expect(out.startsWith('---')).toBe(true);
    expect(out).toContain('tags: ["x"]');
    expect(out).toContain('- foo');
  });

  it('does not destroy an existing entry when adding another', () => {
    const md = `## Known Gotchas\n\n- **2026-07-01:** first\n`;
    const out = insertUnderHeading(md, ['Known Gotchas'], '- **2026-07-04:** second');
    expect(out).toContain('- **2026-07-01:** first');
    expect(out).toContain('- **2026-07-04:** second');
  });
});

describe('formatEntry', () => {
  const ts = '2026-07-04T10:00:00.000Z';

  it('formats a decision with a title as a dated ### block', () => {
    const out = formatEntry({ type: 'decision', message: 'use worktrees', title: 'Worktrees', timestamp: ts }, 'workspace');
    expect(out).toBe('### 2026-07-04 — Worktrees\n**Decision:** use worktrees');
  });

  it('leads a gotcha with its title so the file stays skimmable', () => {
    // The file only grows, so a reader must be able to judge relevance from the
    // first few words instead of reading every entry.
    const out = formatEntry(
      { type: 'gotcha', title: 'EBUSY on Windows', message: 'fs.rm needs maxRetries', timestamp: ts },
      'workspace',
    );
    expect(out).toBe('- **EBUSY on Windows** (2026-07-04) — fs.rm needs maxRetries');
  });

  it('falls back to a truncated message when a gotcha has no title', () => {
    const out = formatEntry({ type: 'gotcha', message: 'EBUSY on Windows', timestamp: ts }, 'workspace');
    expect(out).toBe('- **EBUSY on Windows** (2026-07-04) — EBUSY on Windows');
  });

  it('formats progress as a checked item', () => {
    const out = formatEntry({ type: 'progress', message: 'shipped rollback', timestamp: ts }, 'workspace');
    expect(out).toBe('- [x] 2026-07-04 — shipped rollback');
  });
});

describe('parseKnowledgeEntries', () => {
  it('parses bullet entries and decision blocks with their types', () => {
    const md = [
      '## Known Gotchas',
      '',
      '- **2026-07-04:** watch out',
      '',
      '## Architecture Decisions',
      '',
      '### 2026-07-04 — Chose X',
      '**Decision:** because',
      '',
    ].join('\n');

    const parsed = parseKnowledgeEntries(md);

    expect(parsed).toContainEqual({
      section: 'Known Gotchas',
      type: 'gotcha',
      text: '- **2026-07-04:** watch out',
    });
    const decision = parsed.find((p) => p.type === 'decision');
    expect(decision?.text).toContain('### 2026-07-04 — Chose X');
    expect(decision?.text).toContain('**Decision:** because');
  });

  it('ignores placeholder and comment lines', () => {
    const md = `## Known Gotchas\n\n<!-- hint -->\n\n_(No gotchas recorded yet.)_\n`;
    expect(parseKnowledgeEntries(md)).toHaveLength(0);
  });
});

// ─── Adapter-routed I/O (in-memory storage mock) ────────────────────────────

describe('knowledge I/O', () => {
  const ws = new Map<string, string>();
  const base = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    ws.clear();
    base.clear();

    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({ id: 'feat' } as any);
    vi.mocked(generators.buildBaseKnowledgeContent).mockImplementation(
      (repo: string) =>
        `# Base Codebase Knowledge — ${repo}\n\n## Discovered Gotchas & Watch-outs\n- None recorded yet.\n\n## Architecture Decisions\n- None recorded yet.\n`,
    );

    vi.mocked(storage.workspaceFileExists).mockImplementation(async (_w, fid, fn) => ws.has(`${fid}/${fn}`));
    vi.mocked(storage.readWorkspaceFile).mockImplementation(async (_w, fid, fn) => ws.get(`${fid}/${fn}`)!);
    vi.mocked(storage.writeWorkspaceFile).mockImplementation(async (_w, fid, fn, c) => {
      ws.set(`${fid}/${fn}`, c);
    });
    vi.mocked(storage.resolveWorkspaceFileUrl).mockImplementation((_w, fid, fn) => `ws:/${fid}/${fn}`);

    vi.mocked(storage.baseFileExists).mockImplementation(async (_w, repo, fn) => base.has(`${repo}/${fn}`));
    vi.mocked(storage.readBaseFile).mockImplementation(async (_w, repo, fn) => base.get(`${repo}/${fn}`)!);
    vi.mocked(storage.writeBaseFile).mockImplementation(async (_w, repo, fn, c) => {
      base.set(`${repo}/${fn}`, c);
    });
    vi.mocked(storage.resolveBaseFileUrl).mockImplementation((_w, repo, fn) => `base:/${repo}/${fn}`);
  });

  it('creates the workspace knowledge file when missing and records the entry', async () => {
    const result = await addWorkspaceKnowledge('/wsp', {
      type: 'decision',
      message: 'store knowledge via the adapter',
      title: 'Adapter routing',
    });

    expect(result.createdFile).toBe(true);
    const content = ws.get('feat/nexusflow-knowledge.md')!;
    expect(content).toContain('## Architecture Decisions');
    expect(content).toContain('**Decision:** store knowledge via the adapter');
  });

  it('rejects an empty message', async () => {
    await expect(
      addWorkspaceKnowledge('/wsp', { type: 'gotcha', message: '   ' }),
    ).rejects.toThrow(/cannot be empty/i);
  });

  it('adds to a repo base file, bootstrapping it from the template', async () => {
    const result = await addBaseKnowledge('/wsp', 'api', { type: 'gotcha', message: 'flaky test on CI' });
    expect(result.createdFile).toBe(true);
    const content = base.get('api/nexusflow-knowledge.md')!;
    expect(content).toContain('## Discovered Gotchas & Watch-outs');
    expect(content).toContain('flaky test on CI');
  });

  it('promotes a gotcha to base knowledge (copy leaves the workspace entry)', async () => {
    ws.set(
      'feat/nexusflow-knowledge.md',
      `# Workspace Knowledge — feat\n\n## Known Gotchas\n\n- **2026-07-04:** shared learning\n`,
    );
    const entries = parseKnowledgeEntries((await readWorkspaceKnowledge('/wsp'))!);

    const result = await promoteKnowledge('/wsp', { repoName: 'api', entries, mode: 'copy' });

    expect(result.promotedCount).toBe(1);
    expect(base.get('api/nexusflow-knowledge.md')).toContain('- **2026-07-04:** shared learning');
    // Copy mode keeps the original.
    expect(ws.get('feat/nexusflow-knowledge.md')).toContain('- **2026-07-04:** shared learning');
  });

  it('move mode replaces the promoted workspace entry with a note', async () => {
    ws.set(
      'feat/nexusflow-knowledge.md',
      `# Workspace Knowledge — feat\n\n## Known Gotchas\n\n- **2026-07-04:** shared learning\n`,
    );
    const entries = parseKnowledgeEntries((await readWorkspaceKnowledge('/wsp'))!);

    await promoteKnowledge('/wsp', { repoName: 'api', entries, mode: 'move' });

    const wsContent = ws.get('feat/nexusflow-knowledge.md')!;
    expect(wsContent).not.toContain('shared learning');
    expect(wsContent).toContain('Promoted to api base knowledge');
    expect(base.get('api/nexusflow-knowledge.md')).toContain('shared learning');
  });
});
