/**
 * @module core/base-knowledge-store
 * Where the local adapter keeps a repository's base knowledge so it outlives
 * every workspace: `<ContextSpace home>/base/<repository key>/`.
 *
 * A repository is identified by its normalized `origin` URL, or by the
 * resolved path of the user's checkout when it has no remote. The directory
 * name is a readable slug plus a hash of that identity, so two repositories
 * that share a folder name never share knowledge.
 *
 * Base knowledge written by earlier versions lives inside each workspace
 * (`<workspace>/.contextspace/base/<repo>/`, legacy `.nexusflow/base/`). Those
 * files are merged into the store the first time the repository's base
 * knowledge is used, idempotently, and are never deleted.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { BRAND_CONFIG, resolveBrandHomeDir } from './brand-config.js';

/** How a repository is identified in the store. */
export interface RepoIdentity {
  kind: 'remote' | 'path';
  /** Normalized remote (`host/owner/repo`) or resolved checkout path. */
  value: string;
}

/**
 * Normalizes a Git remote URL to `host/path` without scheme, credentials,
 * port or `.git`, lower-cased. `https://github.com/Org/Repo.git` and
 * `git@github.com:org/repo` are the same repository.
 */
export function normalizeRemoteIdentity(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  let host = '';
  let repoPath = '';
  const scp = raw.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'file:') return null;
      host = parsed.hostname;
      repoPath = parsed.pathname;
    } catch {
      return null;
    }
  } else if (scp && !/^[a-z]:$/i.test(`${scp[1]}:`)) {
    host = scp[1]!;
    repoPath = scp[2]!;
  } else {
    return null; // A local path remote identifies nothing portable.
  }
  const cleaned = repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!host || !cleaned) return null;
  return `${host}/${cleaned}`.toLowerCase();
}

function originUrl(repoPath: string): string | null {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim() || null;
  } catch {
    return null;
  }
}

/** Identity of the repository checked out at `sourcePath`, or `null` when it is not a directory. */
export function repoIdentity(sourcePath: string): RepoIdentity | null {
  try {
    if (!statSync(sourcePath).isDirectory()) return null;
  } catch {
    return null;
  }
  const remote = originUrl(sourcePath);
  const normalized = remote ? normalizeRemoteIdentity(remote) : null;
  if (normalized) return { kind: 'remote', value: normalized };
  try {
    return { kind: 'path', value: realpathSync(sourcePath) };
  } catch {
    return null;
  }
}

/** Directory name for an identity: readable, and unique through its hash. */
export function storeDirName(identity: RepoIdentity): string {
  const hash = createHash('sha256').update(`${identity.kind}:${identity.value}`).digest('hex').slice(0, 12);
  const slug = identity.value
    .replace(/^[a-z]:/i, '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-2)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `${slug || 'repo'}-${hash}`;
}

/** Root of the user-level base knowledge store. */
export function baseStoreRoot(): string {
  return path.join(resolveBrandHomeDir(), 'base');
}

/** The store directory for a repository identity. */
export function storeDirFor(identity: RepoIdentity): string {
  return path.join(baseStoreRoot(), storeDirName(identity));
}

interface ManifestLike {
  repos?: unknown;
  originalRepos?: unknown;
}

/** The user's own checkout behind `repoName` in a workspace manifest, or `null`. */
export function sourceRepoPath(workspacePath: string, repoName: string): string | null {
  for (const file of [BRAND_CONFIG.files.manifest.primary, BRAND_CONFIG.files.manifest.legacy]) {
    const manifestPath = path.join(workspacePath, file);
    if (!existsSync(manifestPath)) continue;
    let manifest: ManifestLike;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestLike;
    } catch {
      return null;
    }
    const repos = Array.isArray(manifest.repos) ? manifest.repos.filter((r): r is string => typeof r === 'string') : [];
    const originals = Array.isArray(manifest.originalRepos) ? manifest.originalRepos : [];
    const wanted = repoName.toLowerCase();
    const index = repos.findIndex((repo) => path.basename(repo).toLowerCase() === wanted);
    if (index < 0) return null;
    const original = originals[index];
    return typeof original === 'string' && original ? original : repos[index]!;
  }
  return null;
}

const IDENTITY_TTL_MS = 30_000;
const identityCache = new Map<string, { at: number; identity: RepoIdentity | null }>();

/**
 * Identity of a workspace repository, cached briefly. `null` when the
 * workspace has no manifest naming the repository or its checkout is gone;
 * callers then keep using the workspace-local location.
 */
export function workspaceRepoIdentity(workspacePath: string, repoName: string): RepoIdentity | null {
  const key = `${path.resolve(workspacePath)}\0${repoName.toLowerCase()}`;
  const cached = identityCache.get(key);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.identity;
  const source = sourceRepoPath(workspacePath, repoName);
  const identity = source ? repoIdentity(source) : null;
  identityCache.set(key, { at: Date.now(), identity });
  return identity;
}

/** Test hook and post-change reset: forget cached identities. */
export function resetBaseStoreIdentityCache(): void {
  identityCache.clear();
}

/**
 * Store files whose lock the current async call chain holds. The lock is not
 * reentrant, so code running inside it (a knowledge write) must not take it
 * again; other concurrent requests in the same process still wait for it.
 */
const heldStoreLocks = new AsyncLocalStorage<ReadonlySet<string>>();

/** Runs `operation` as the holder of the lock on `storeFile`. */
export function runHoldingStoreLock<T>(storeFile: string, operation: () => Promise<T>): Promise<T> {
  const held = new Set(heldStoreLocks.getStore() ?? []);
  held.add(path.resolve(storeFile));
  return heldStoreLocks.run(held, operation);
}

/** Whether the current async call chain holds the lock on `storeFile`. */
export function holdsStoreLock(storeFile: string): boolean {
  return heldStoreLocks.getStore()?.has(path.resolve(storeFile)) ?? false;
}

/** Async identity of a checkout, for sweeps that must not block the event loop. */
export async function repoIdentityAsync(sourcePath: string): Promise<RepoIdentity | null> {
  const { stat, realpath } = await import('node:fs/promises');
  const { execa } = await import('execa');
  if (!(await stat(sourcePath).then((s) => s.isDirectory(), () => false))) return null;
  const remote = await execa('git', ['config', '--get', 'remote.origin.url'], { cwd: sourcePath, reject: false, timeout: 5_000 }).catch(() => null);
  const normalized = remote && remote.exitCode === 0 ? normalizeRemoteIdentity(remote.stdout) : null;
  if (normalized) return { kind: 'remote', value: normalized };
  return realpath(sourcePath).then((value) => ({ kind: 'path' as const, value }), () => null);
}

// ── Merging per-workspace files into the store ─────────────────────────────

interface KnowledgeBlock {
  /** `## ` section the block belongs to ('' before the first section). */
  section: string;
  /** `### ` heading line, when the block is a headed entry. */
  heading?: string;
  text: string;
}

const PLACEHOLDER = /^-\s+None recorded yet\.?\s*$/i;

/** Line endings and trailing space do not make an entry different. */
function normalizeBlock(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/\s+$/, '')).join('\n').trim();
}

/** Splits knowledge Markdown into entries: `### ` headed blocks and top-level bullets. */
export function splitKnowledgeBlocks(markdown: string): KnowledgeBlock[] {
  const blocks: KnowledgeBlock[] = [];
  let section = '';
  let current: KnowledgeBlock | null = null;
  const flush = () => {
    if (current) {
      current.text = current.text.replace(/\s+$/, '');
      if (current.text && !PLACEHOLDER.test(current.text)) blocks.push(current);
    }
    current = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{1,2}\s+/.test(line)) {
      flush();
      section = /^##\s+/.test(line) ? line.replace(/^##\s+/, '').trim() : '';
      continue;
    }
    if (/^###\s+/.test(line)) {
      flush();
      current = { section, heading: line.trim(), text: line };
      continue;
    }
    if (/^[-*]\s+/.test(line) && !(current as KnowledgeBlock | null)?.heading) {
      flush();
      current = { section, text: line };
      continue;
    }
    if (current) {
      (current as KnowledgeBlock).text += `\n${line}`;
    } else if (line.trim() && section) {
      current = { section, text: line };
    }
  }
  flush();
  return blocks;
}

/** Result of merging one source into the store content. */
export interface KnowledgeMerge {
  content: string;
  added: number;
  /** Headings that already existed with different content; kept under a suffixed heading. */
  conflicts: string[];
}

/**
 * Merges the entries of `incoming` into `existing` without losing or
 * duplicating any: identical entries are skipped, new ones are placed under
 * their section, and a heading that already exists with different content is
 * kept under a suffixed heading and reported.
 *
 * @param insert - Places an entry under a section (the knowledge module's insertUnderHeading).
 * @param origin - Short label for the source, used in conflict headings.
 */
export function mergeKnowledge(
  existing: string,
  incoming: string,
  origin: string,
  insert: (markdown: string, headingAliases: string[], entry: string) => string,
): KnowledgeMerge {
  let content = existing;
  let added = 0;
  const conflicts: string[] = [];
  // Whole entries are compared, never substrings: "- Use pnpm" is not a
  // duplicate of "- Use pnpm for installs, never npm".
  const present = new Set(splitKnowledgeBlocks(content).map((block) => normalizeBlock(block.text)));
  const headings = new Set(splitKnowledgeBlocks(content).flatMap((block) => (block.heading ? [block.heading] : [])));
  for (const block of splitKnowledgeBlocks(incoming)) {
    if (present.has(normalizeBlock(block.text))) continue;
    let text = block.text;
    if (block.heading && headings.has(block.heading)) {
      const renamed = `${block.heading} (from ${origin})`;
      conflicts.push(block.heading.replace(/^###\s+/, ''));
      text = [renamed, ...block.text.split(/\r?\n/).slice(1)].join('\n');
      if (present.has(normalizeBlock(text))) continue;
    }
    content = insert(content, [block.section || 'Notes'], text);
    present.add(normalizeBlock(text));
    const heading = text.split(/\r?\n/, 1)[0]!;
    if (heading.startsWith('### ')) headings.add(heading.trim());
    added += 1;
  }
  return { content, added, conflicts };
}
