/**
 * @module analyzers/readme-summarizer
 * Extracts a summary from a repository's README.md file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Reads a repository's README.md and extracts the first meaningful
 * prose paragraph as a summary. Looks for README.md (case-insensitive).
 *
 * It automatically strips badges, TOC lists, headers, HTML tags, and redacts ClientIDs/Secrets.
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

  // 1. Strip code blocks to avoid false matching on secrets/prose
  content = content.replace(/```[\s\S]*?```/g, '');

  // 2. Scrub ClientIDs/Secrets/Credentials
  // Match standard secret/ID patterns: GUIDs, client_id/secret variables, hex keys
  const clientSecretsRegex = /(client_id|client_secret|appid|secret|password|key|token|credential)\s*[:=]\s*["']?[a-zA-Z0-9-_\/\+\.]{16,}["']?/gi;
  const guidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/g;
  
  content = content
    .replace(clientSecretsRegex, (match, p1) => `${p1}: [REDACTED]`)
    .replace(guidRegex, '[REDACTED_ID]');

  // 3. Process line-by-line to find the first prose paragraph
  const lines = content.split('\n');
  const proseLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (proseLines.length > 0) {
        // We found a paragraph and hit an empty line. Let's finish!
        break;
      }
      continue;
    }

    // Skip HTML tags
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) continue;

    // Skip badges
    if (trimmed.startsWith('[![') || (trimmed.startsWith('![') && trimmed.includes('http'))) continue;

    // Skip horizontal rules
    if (/^(-{3,}|={3,}|\*{3,})$/.test(trimmed)) continue;

    // Skip headers (Markdown # )
    if (trimmed.startsWith('#')) continue;

    // Detect Table of Contents (TOC) lists
    // Skip lines that look like: - [About](#about) or * 1. [Section](#section)
    if (/^[-*+]\s*(\d+\.)?\s*\[[^\]]+\]\(#[^)]+\)/.test(trimmed)) {
      continue;
    }

    // Skip standard bullet lists if we are searching for prose (e.g. at the top of README before prose)
    if (proseLines.length === 0 && /^[-*+]\s+/.test(trimmed)) {
      continue;
    }

    // Accumulate prose lines
    proseLines.push(line);
  }

  const summary = proseLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!summary) return null;
  
  // Limit the summary to a concise paragraph (first 250 characters)
  return summary.length > 250 ? summary.slice(0, 250) + '...' : summary;
}
