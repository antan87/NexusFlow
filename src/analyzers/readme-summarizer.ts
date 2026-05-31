/**
 * @module analyzers/readme-summarizer
 * Extracts a summary from a repository's README.md file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Maximum chars to extract from README for summary. */
const MAX_SUMMARY_LENGTH = 800;

/**
 * Reads a repository's README.md and extracts the first meaningful
 * section as a summary. Looks for README.md (case-insensitive).
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns The extracted summary text, or null if no README is found.
 */
export async function extractReadmeSummary(
  repoPath: string,
): Promise<string | null> {
  // Try common README filenames
  const candidates = ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README'];

  let content: string | null = null;

  for (const filename of candidates) {
    try {
      content = await fs.readFile(path.join(repoPath, filename), 'utf-8');
      break;
    } catch {
      continue;
    }
  }

  if (!content) return null;

  // Strip badges, images, and HTML at the top
  const lines = content.split('\n');
  const meaningfulLines: string[] = [];
  let foundContent = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines before content starts
    if (!foundContent && !trimmed) continue;

    // Skip badge lines ([![...](...)]) and image lines (![...](...)
    if (trimmed.startsWith('[![') || (trimmed.startsWith('![') && trimmed.includes('http'))) continue;

    // Skip HTML tags
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) continue;

    // Skip horizontal rules
    if (/^(-{3,}|={3,}|\*{3,})$/.test(trimmed)) continue;

    foundContent = true;
    meaningfulLines.push(line);

    // Stop after we have enough content
    const currentLength = meaningfulLines.join('\n').length;
    if (currentLength >= MAX_SUMMARY_LENGTH) break;
  }

  const summary = meaningfulLines.join('\n').slice(0, MAX_SUMMARY_LENGTH).trim();
  return summary || null;
}
