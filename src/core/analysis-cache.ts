/**
 * @module core/analysis-cache
 * Persists per-repo analysis results in `.nexusflow-analysis-cache.json` at
 * the workspace root, keyed by a git content fingerprint (HEAD SHA plus a
 * signature of dirty files). Lets refresh/sync re-analyze only repos whose
 * content actually changed, keeping unchanged maps byte-identical — which
 * avoids file churn and preserves AI assistants' prompt caches (token saving).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import type { ProjectAnalysis } from '../types.js';

/** Name of the analysis cache file, written at the workspace root. */
const CACHE_FILE = '.nexusflow-analysis-cache.json';

/** A cached analysis result for a single repo. */
export interface AnalysisCacheEntry {
  /** Directory name of the repo. */
  repoName: string;
  /** Content fingerprint of the repo when the analysis ran. */
  fingerprint: string;
  /** ISO timestamp of when the analysis ran. */
  analyzedAt: string;
  /** The cached analysis result. */
  analysis: ProjectAnalysis;
}

/** On-disk shape of the analysis cache. */
export interface AnalysisCache {
  version: 1;
  /** Entries keyed by repo name. */
  repos: Record<string, AnalysisCacheEntry>;
}

/**
 * Returns the path to the analysis cache file for a workspace.
 */
export function getAnalysisCachePath(workspacePath: string): string {
  return path.join(workspacePath, CACHE_FILE);
}

/**
 * Loads the analysis cache, returning an empty skeleton when the file does
 * not exist or cannot be parsed.
 *
 * @param workspacePath - Absolute path to the workspace root.
 */
export async function loadAnalysisCache(
  workspacePath: string,
): Promise<AnalysisCache> {
  try {
    const raw = await fs.readFile(getAnalysisCachePath(workspacePath), 'utf-8');
    const cache = JSON.parse(raw) as AnalysisCache;
    if (!cache.repos || typeof cache.repos !== 'object') {
      cache.repos = {};
    }
    return cache;
  } catch {
    return { version: 1, repos: {} };
  }
}

/**
 * Saves the analysis cache, pruning entries for repos that are no longer in
 * the given list of current repo names.
 *
 * @param workspacePath    - Absolute path to the workspace root.
 * @param cache            - The cache to persist.
 * @param currentRepoNames - Names of repos currently in the workspace; when
 *                           provided, entries for other repos are dropped.
 */
export async function saveAnalysisCache(
  workspacePath: string,
  cache: AnalysisCache,
  currentRepoNames?: string[],
): Promise<void> {
  if (currentRepoNames) {
    for (const name of Object.keys(cache.repos)) {
      if (!currentRepoNames.includes(name)) {
        delete cache.repos[name];
      }
    }
  }
  const data = JSON.stringify(cache, null, 2) + '\n';
  await fs.writeFile(getAnalysisCachePath(workspacePath), data, 'utf-8');
}

/**
 * Strips the surrounding quotes git adds to porcelain paths containing
 * special characters.
 */
function unquotePorcelainPath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1);
  }
  return p;
}

/**
 * Computes a content fingerprint for a repo: the HEAD commit SHA, extended
 * with a hash of the dirty working-tree files (status line + size + mtime per
 * file) when the tree is not clean. Editing, adding, or deleting an
 * uncommitted file therefore changes the fingerprint too.
 *
 * @param repoPath - Absolute path to the repo root.
 * @returns The fingerprint, or null when git fails (caller should re-analyze).
 */
export async function getRepoFingerprint(
  repoPath: string,
): Promise<string | null> {
  try {
    const { stdout: shaOut } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
    });
    const sha = shaOut.trim();

    const { stdout: statusOut } = await execa('git', ['status', '--porcelain'], {
      cwd: repoPath,
    });
    const lines = statusOut.split('\n').filter(Boolean);
    if (lines.length === 0) {
      return sha;
    }

    let dirtySignature = '';
    for (const line of lines) {
      const rel = line.slice(3).trim();
      // Rename lines look like "R  old -> new"; stat the new path.
      const target = rel.includes(' -> ') ? rel.split(' -> ').pop()! : rel;
      const filePath = path.join(repoPath, unquotePorcelainPath(target));
      try {
        const st = await fs.stat(filePath);
        dirtySignature += `${line}|${st.size}|${Math.floor(st.mtimeMs)}\n`;
      } catch {
        dirtySignature += `${line}|missing\n`;
      }
    }

    const dirtyHash = createHash('sha1')
      .update(dirtySignature)
      .digest('hex')
      .slice(0, 12);
    return `${sha}+${dirtyHash}`;
  } catch {
    return null;
  }
}
