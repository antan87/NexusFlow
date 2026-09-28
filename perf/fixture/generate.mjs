#!/usr/bin/env node
/**
 * Seeded scale fixture for performance measurement.
 *
 * Builds a self-contained HOME with a ContextSpace config, Git repositories,
 * in-place workspaces with isolated worktrees, and Claude/Codex session
 * history. Everything the app reads resolves through HOME, so pointing the
 * backend at `<out>/home` (see perf/lib/env.mjs) never touches real user data.
 *
 * Same tier + seed => same file tree and Git object IDs. File contents embed
 * absolute paths, so byte-identical output also needs the same --out path.
 *
 *   node perf/fixture/generate.mjs --tier S --out /tmp/cs-perf-S [--seed 1] [--no-faults]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATOR_VERSION = 1;

/**
 * Dataset tiers (design review v2 §5). Sizes are targets: rollout sizes are
 * drawn from the seeded generator and scaled so the tier total is exact.
 */
export const TIERS = {
  S: {
    repos: [{ files: 1_000 }],
    workspaces: 3,
    reposPerWorkspace: 1,
    dirtyWorktrees: 1,
    untrackedInSource: 20,
    codex: { rollouts: 10, totalMB: 5, maxMB: 2, matching: 3 },
    claude: { transcripts: 5, totalMB: 2, maxMB: 1, workspaces: 2 },
  },
  M: {
    // Mirrors the reference laptop on 2026-09-28: 31 workspaces mostly on one
    // repo, 75 Codex rollouts (257 MB, max 29 MB), 5 Claude transcripts (15 MB).
    repos: [{ files: 20_000 }, { files: 5_000 }, { files: 1_000 }],
    workspaces: 31,
    reposPerWorkspace: 1,
    dirtyWorktrees: 6,
    untrackedInSource: 200,
    codex: { rollouts: 75, totalMB: 257, maxMB: 29, matching: 25 },
    claude: { transcripts: 5, totalMB: 15, maxMB: 6, workspaces: 3 },
  },
  L: {
    // Growth case. Only the first repo of each workspace gets a worktree, and
    // the 100k-file repo is isolated in 5 workspaces; the rest use it in place.
    repos: [{ files: 100_000, isolateIn: 5 }, { files: 20_000 }, { files: 20_000 }, { files: 5_000 }, { files: 1_000 }],
    workspaces: 50,
    reposPerWorkspace: 3,
    dirtyWorktrees: 12,
    untrackedInSource: 2_000,
    codex: { rollouts: 500, totalMB: 1_200, maxMB: 80, matching: 120, largeCount: 5, largeMinMB: 50 },
    claude: { transcripts: 200, totalMB: 200, maxMB: 20, workspaces: 2 },
  },
};

const BASE_TIME = Date.parse('2026-09-01T08:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** mulberry32: small, fast, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(rand) {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const pad = (n, w = 3) => String(n).padStart(w, '0');

/** Mirrors getClaudeProjectFolderName in src/utils/session-finder.ts. */
const claudeFolderName = (p) => p.replace(/[/\\]+$/, '').replace(/[^a-zA-Z0-9]/g, '-');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Perf Fixture',
  GIT_AUTHOR_EMAIL: 'perf@fixture.invalid',
  GIT_COMMITTER_NAME: 'Perf Fixture',
  GIT_COMMITTER_EMAIL: 'perf@fixture.invalid',
  GIT_AUTHOR_DATE: '2026-09-01T08:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-01T08:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
}

function sourceFile(rand, repoIndex, fileIndex) {
  const lines = 10 + Math.floor(rand() * 60);
  const out = [`// fixture repo ${repoIndex} file ${fileIndex}`];
  for (let i = 0; i < lines; i += 1) {
    out.push(`export const value_${fileIndex}_${i} = ${Math.floor(rand() * 1e6)}; // ${'x'.repeat(Math.floor(rand() * 40))}`);
  }
  return out.join('\n') + '\n';
}

/** Files spread over nested folders, 50 per folder, like a real source tree. */
function filePath(fileIndex) {
  const dir = Math.floor(fileIndex / 50);
  return path.join('src', `pkg${pad(Math.floor(dir / 40), 2)}`, `mod${pad(dir % 40, 2)}`, `file${pad(fileIndex, 6)}.ts`);
}

async function writeFiles(root, entries) {
  // Bounded concurrency keeps 100k-file repos fast without exhausting handles.
  const dirs = new Set(entries.map(([rel]) => path.dirname(path.join(root, rel))));
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < entries.length; i += 256) {
    await Promise.all(entries.slice(i, i + 256).map(([rel, content]) => fs.writeFile(path.join(root, rel), content)));
  }
}

async function createRepo(repoPath, repoIndex, files, rand) {
  await fs.mkdir(repoPath, { recursive: true });
  git(repoPath, ['init', '-q', '-b', 'main']);
  const entries = [['README.md', `# fixture-repo-${repoIndex}\n`], ['.gitignore', 'node_modules/\n']];
  for (let i = 0; i < files; i += 1) entries.push([filePath(i), sourceFile(rand, repoIndex, i)]);
  await writeFiles(repoPath, entries);
  git(repoPath, ['add', '-A']);
  git(repoPath, ['commit', '-q', '-m', 'fixture: initial tree']);
}

async function dirty(worktree, rand, modified, untracked) {
  const tracked = git(worktree, ['ls-files', 'src']).split('\n').filter(Boolean);
  for (let i = 0; i < modified && tracked.length; i += 1) {
    const rel = tracked[Math.floor(rand() * tracked.length)];
    await fs.appendFile(path.join(worktree, rel), `export const edited_${i} = ${Math.floor(rand() * 1e6)};\n`);
  }
  const extra = [];
  for (let i = 0; i < untracked; i += 1) {
    extra.push([path.join('scratch-untracked', `dir${pad(Math.floor(i / 100), 2)}`, `new${pad(i, 5)}.ts`), sourceFile(rand, 99, i)]);
  }
  await writeFiles(worktree, extra);
}

/** Scale seeded weights so they sum to `total` and respect `max`/large-file floors. */
function sizesMB(rand, count, total, max, largeCount = 0, largeMin = 0) {
  const sizes = Array.from({ length: count }, (_, i) =>
    i < largeCount ? largeMin + rand() * (max - largeMin) : Math.exp(rand() * 3) * 0.2,
  );
  sizes[largeCount] = Math.max(sizes[largeCount] ?? 0, max * 0.9); // one near-max ordinary file
  const out = sizes.slice();
  // Scale the ordinary files to the remaining budget; mass clipped at `max` is
  // redistributed over the files still below it.
  const capped = new Set();
  for (let pass = 0; pass < 8; pass += 1) {
    const fixed = out.reduce((a, s, i) => (i < largeCount || capped.has(i) ? a + s : a), 0);
    const free = out.reduce((a, s, i) => (i < largeCount || capped.has(i) ? a : a + s), 0);
    if (free <= 0) break;
    const scale = Math.max(0, total - fixed) / free;
    let clipped = false;
    for (let i = largeCount; i < out.length; i += 1) {
      if (capped.has(i)) continue;
      out[i] *= scale;
      if (out[i] > max) { out[i] = max; capped.add(i); clipped = true; }
    }
    if (!clipped) break;
  }
  return out;
}

/** Streams JSONL lines until the file reaches `bytes`. */
async function writeJsonl(file, header, nextLine, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const out = createWriteStream(file);
  let written = 0;
  const write = (line) => {
    const text = line + '\n';
    written += Buffer.byteLength(text);
    return out.write(text) ? Promise.resolve() : new Promise((r) => out.once('drain', r));
  };
  for (const line of header) await write(line);
  let i = 0;
  while (written < bytes) await write(nextLine(i++));
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  return written;
}

function filler(rand, n) {
  const words = ['index', 'workspace', 'session', 'measure', 'budget', 'diff', 'status', 'cache', 'render', 'commit'];
  return Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ');
}

async function writeCodexRollout(file, id, cwd, time, bytes, rand) {
  const ts = (i) => new Date(time + i * 1000).toISOString();
  const header = [JSON.stringify({ timestamp: ts(0), type: 'session_meta', payload: { id, timestamp: ts(0), cwd, originator: 'codex_cli_rs', cli_version: '0.99.0' } })];
  return writeJsonl(file, header, (i) => {
    if (i % 25 === 24) {
      return JSON.stringify({ timestamp: ts(i + 1), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000 * i, output_tokens: 200 * i } } } });
    }
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const type = role === 'user' ? 'input_text' : 'output_text';
    return JSON.stringify({ timestamp: ts(i + 1), type: 'response_item', payload: { type: 'message', role, content: [{ type, text: filler(rand, 400) }] } });
  }, bytes);
}

async function writeClaudeTranscript(file, sessionId, cwd, time, bytes, rand) {
  let parent = null;
  return writeJsonl(file, [], (i) => {
    const uuidValue = uuid(rand);
    const type = i % 2 === 0 ? 'user' : 'assistant';
    const record = {
      parentUuid: parent, isSidechain: false, type, sessionId, cwd, uuid: uuidValue,
      timestamp: new Date(time + i * 1000).toISOString(),
      message: type === 'user'
        ? { role: 'user', content: filler(rand, 300) }
        : { role: 'assistant', content: [{ type: 'text', text: filler(rand, 500) }], usage: { input_tokens: 1200, output_tokens: 300 } },
    };
    parent = uuidValue;
    return JSON.stringify(record);
  }, bytes);
}

/**
 * Order-independent digest of every generated path and size (not contents).
 * Claude folder names encode the absolute root, so it is replaced by a token.
 */
async function treeDigest(root, fixtureRoot) {
  const lines = [];
  const encodedRoot = claudeFolderName(fixtureRoot);
  const rel = (p) => path.relative(root, p).split(encodedRoot).join('<root>');
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { lines.push(`${rel(dir)}/ unreadable`); return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.name === '.git') continue; // object packing varies; commit IDs are recorded instead
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) lines.push(`${rel(p)} ${(await fs.stat(p)).size}`);
    }
  }
  await walk(root);
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

export async function generateFixture({ tier = 'S', seed = 1, out, faults = tier !== 'S' }) {
  const spec = TIERS[tier];
  if (!spec) throw new Error(`Unknown tier "${tier}". Use one of: ${Object.keys(TIERS).join(', ')}`);
  if (!out) throw new Error('An output directory is required.');
  const root = path.resolve(out);
  if (existsSync(root) && (await fs.readdir(root)).length) throw new Error(`Output directory is not empty: ${root}`);

  const rand = rng(seed);
  const home = path.join(root, 'home');
  const devDir = path.join(home, 'dev', 'projects');
  const workspacesDir = path.join(home, 'dev', 'workspaces');
  const started = Date.now();

  await fs.mkdir(path.join(home, '.contextspace'), { recursive: true });
  await fs.writeFile(path.join(home, '.contextspace', 'config.json'), JSON.stringify({
    version: '1.0.0', devDir, workspacesDir, defaultAssistant: 'claude', scanDepth: 2,
    excludePatterns: ['**/node_modules/**', '**/.git/**'], storageProvider: 'local',
    // Suppress the update check so runs never depend on the network.
    lastUpdateCheck: new Date(8.64e15).toISOString(),
  }, null, 2));

  const repos = [];
  for (const [i, repoSpec] of spec.repos.entries()) {
    const repoPath = path.join(devDir, `fixture-repo-${i}`);
    await createRepo(repoPath, i, repoSpec.files, rand);
    repos.push({ ...repoSpec, name: `fixture-repo-${i}`, path: repoPath, commit: git(repoPath, ['rev-parse', 'HEAD']).trim() });
  }
  const isolatedCount = new Map(repos.map((r) => [r.path, 0]));

  const workspaces = [];
  for (let w = 0; w < spec.workspaces; w += 1) {
    const id = `perf-ws-${pad(w)}`;
    const workspacePath = path.join(workspacesDir, id);
    await fs.mkdir(workspacePath, { recursive: true });
    // Most workspaces share the first repo, like a real single-product machine.
    const first = w % 8 === 7 ? 1 % repos.length : 0;
    const chosen = [first];
    for (let k = 1; chosen.length < Math.min(spec.reposPerWorkspace, repos.length); k += 1) {
      const idx = (first + k) % repos.length;
      if (!chosen.includes(idx)) chosen.push(idx);
    }
    const isolatedRepos = {};
    for (const [position, idx] of chosen.entries()) {
      const repo = repos[idx];
      const limit = repo.isolateIn ?? Infinity;
      if (position > 0 || isolatedCount.get(repo.path) >= limit) continue;
      isolatedCount.set(repo.path, isolatedCount.get(repo.path) + 1);
      const worktreePath = path.join(workspacePath, repo.name);
      const branchName = `perf/${id}`;
      git(repo.path, ['worktree', 'add', '-q', '-b', branchName, worktreePath, 'main']);
      if (w < spec.dirtyWorktrees) await dirty(worktreePath, rand, 5 + (w % 3) * 10, 10 + (w % 4) * 15);
      isolatedRepos[repo.name] = { worktreePath, branchName, baseBranch: 'main', isolatedAt: new Date(BASE_TIME).toISOString() };
    }
    const manifest = {
      id, name: `Perf workspace ${pad(w)}`, mode: 'in-place', branchName: id,
      description: `Seeded performance fixture workspace ${w}.`,
      repos: chosen.map((i) => repos[i].path), originalRepos: chosen.map((i) => repos[i].path),
      assistants: ['claude', 'codex'], workspacePath,
      createdAt: new Date(BASE_TIME + w * 60_000).toISOString(),
      workType: 'feature', flowType: 'feature', isolatedRepos,
    };
    await fs.writeFile(path.join(workspacePath, 'contextspace.json'), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), `# ${manifest.name}\n\n${manifest.description}\n`);
    // Assistants run from the workspace root, as they do on real machines.
    workspaces.push({ id, path: workspacePath, cwd: workspacePath });
  }

  // Untracked files in the most-shared source repo (seen by in-place users).
  await dirty(repos[0].path, rand, 0, spec.untrackedInSource);

  const faultList = [];
  const unreadablePaths = [];
  if (faults) {
    const missing = path.join(workspacesDir, 'perf-fault-missing-repo');
    await fs.mkdir(missing, { recursive: true });
    await fs.writeFile(path.join(missing, 'contextspace.json'), JSON.stringify({
      id: 'perf-fault-missing-repo', name: 'Fault: missing repo', mode: 'in-place', branchName: 'perf-fault-missing-repo',
      description: 'Repository path does not exist.', repos: [path.join(root, 'does-not-exist', 'repo')],
      originalRepos: [path.join(root, 'does-not-exist', 'repo')], assistants: ['claude'], workspacePath: missing,
      createdAt: new Date(BASE_TIME - DAY).toISOString(), workType: 'bug', flowType: 'feature', isolatedRepos: {},
    }, null, 2));
    faultList.push('missing-repo');
    if (process.platform !== 'win32' && process.getuid?.() !== 0 && workspaces.length > 1) {
      // The last workspace's worktree becomes unreadable; removeFixture() restores it.
      const unreadable = Object.values(JSON.parse(await fs.readFile(path.join(workspaces.at(-1).path, 'contextspace.json'), 'utf8')).isolatedRepos)[0]?.worktreePath;
      if (unreadable) { await fs.chmod(unreadable, 0o000); faultList.push('unreadable-worktree'); unreadablePaths.push(unreadable); }
    }
  }

  // Codex rollouts: newest first by name; the newest `matching` ones belong to fixture workspaces.
  const codex = spec.codex;
  const codexSizes = sizesMB(rand, codex.rollouts, codex.totalMB, codex.maxMB, codex.largeCount, codex.largeMinMB);
  let codexBytes = 0;
  for (let r = 0; r < codex.rollouts; r += 1) {
    const time = BASE_TIME + 30 * DAY - r * (DAY / 4);
    const d = new Date(time);
    const id = uuid(rand);
    const stamp = d.toISOString().slice(0, 19).replace(/:/g, '-');
    const file = path.join(home, '.codex', 'sessions', String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1, 2), pad(d.getUTCDate(), 2), `rollout-${stamp}-${id}.jsonl`);
    const cwd = r < codex.matching ? workspaces[r % workspaces.length].cwd : path.join(root, 'elsewhere', `project${pad(r)}`);
    // Large files go to matching workspaces so they are actually parsed.
    const size = codexSizes[r < codex.matching ? r : codex.rollouts - 1 - (r - codex.matching)];
    codexBytes += await writeCodexRollout(file, id, cwd, time, Math.max(2_000, Math.round(size * 1024 * 1024)), rand);
  }

  const claude = spec.claude;
  const claudeSizes = sizesMB(rand, claude.transcripts, claude.totalMB, claude.maxMB);
  let claudeBytes = 0;
  for (let t = 0; t < claude.transcripts; t += 1) {
    const ws = workspaces[t % Math.min(claude.workspaces, workspaces.length)];
    const sessionId = uuid(rand);
    const file = path.join(home, '.claude', 'projects', claudeFolderName(ws.cwd), `${sessionId}.jsonl`);
    claudeBytes += await writeClaudeTranscript(file, sessionId, ws.cwd, BASE_TIME + 20 * DAY - t * 3_600_000, Math.max(2_000, Math.round(claudeSizes[t] * 1024 * 1024)), rand);
  }

  const manifest = {
    generatorVersion: GENERATOR_VERSION, tier, seed, root, home,
    generatedIn: `${((Date.now() - started) / 1000).toFixed(1)}s`,
    repos: repos.map(({ name, files, commit }) => ({ name, files, commit })),
    workspaces: workspaces.length, faults: faultList, unreadablePaths,
    codex: { rollouts: codex.rollouts, matching: codex.matching, bytes: codexBytes },
    claude: { transcripts: claude.transcripts, bytes: claudeBytes },
  };
  manifest.treeDigest = await treeDigest(home, root);
  await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Deletes a fixture, first restoring access to any fault-injected folders. */
export async function removeFixture(out) {
  const root = path.resolve(out);
  try {
    const { unreadablePaths = [] } = JSON.parse(await fs.readFile(path.join(root, 'fixture.json'), 'utf8'));
    for (const p of unreadablePaths) await fs.chmod(p, 0o755).catch(() => {});
  } catch {
    // No manifest: an interrupted generation. Removal may still succeed.
  }
  await fs.rm(root, { recursive: true, force: true });
}

function parseArgs(argv) {
  const args = { faults: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tier') args.tier = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-faults') args.faults = false;
    else if (a === '--faults') args.faults = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const manifest = await generateFixture({ ...args, faults: args.faults ?? (args.tier ?? 'S') !== 'S' });
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
