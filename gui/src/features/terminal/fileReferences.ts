import { fileUrlToPath, splitLocation, trimTrailingPunctuation } from '../../lib/fileReference.js';
import { isWebOrDomain } from './webLinks.js';

export interface FileReference { text: string; path: string; line?: number; start: number; end: number }

const MARKDOWN_LINK = /\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g;

/** The path and line a printed token names, or null when it does not look like a file path. */
function toPathAndLine(text: string): { path: string; line?: number } | null {
  const location = splitLocation(text);
  let path = location.path.replace(/['"`>]$/, '');
  path = fileUrlToPath(path).replace(/#.*$/, '');
  if (!path || isWebOrDomain(path)) return null;
  if (!/[/\\]/.test(path) && !/^[^.:]+(?:\.[a-z\d_-]+)*\.[a-z][a-z\d]{0,11}$/i.test(path)) return null;
  if (/^(?:\.\.?[/\\])?$/.test(path)) return null;
  return { path, line: location.line };
}

/** Find file paths in terminal output, retaining spaces inside quoted paths and stripping markdown/angle wrapper syntax. */
export function findFileReferences(row: string): FileReference[] {
  const result: FileReference[] = [];
  const handledRanges: [number, number][] = [];

  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK.exec(row)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    handledRanges.push([matchStart, matchEnd]);

    let raw = match[2].trim();
    let unwrapped = false;
    if (raw.startsWith('<') && raw.endsWith('>')) {
      raw = raw.slice(1, -1).trim();
      unwrapped = true;
    }
    if (isWebOrDomain(raw)) continue;

    const text = trimTrailingPunctuation(raw);
    const reference = toPathAndLine(text);
    if (!reference) continue;

    const targetOffset = match[0].indexOf(match[2]) + (unwrapped ? 1 : 0);
    const start = matchStart + targetOffset;
    result.push({ text, ...reference, start, end: start + text.length });
  }

  for (let index = 0; index < row.length;) {
    if (/\s/.test(row[index])) { index++; continue; }
    const range = handledRanges.find(([s, e]) => index >= s && index < e);
    if (range) { index = range[1]; continue; }

    const tokenStart = index;
    let quote: '"' | "'" | '`' | null = null;
    while (index < row.length) {
      const char = row[index];
      if (quote && char === quote) quote = null;
      else if (!quote && (char === '"' || char === "'" || char === '`') && /^[([{<]*$/.test(row.slice(tokenStart, index))) quote = char;
      else if (/\s/.test(char) && !quote) break;
      index++;
    }
    const token = row.slice(tokenStart, index);
    const leading = token.match(/^[('"`[{<]*/)?.[0].length ?? 0;
    const text = trimTrailingPunctuation(token.slice(leading));
    const reference = toPathAndLine(text);
    if (!reference) continue;
    const start = tokenStart + leading;
    result.push({ text, ...reference, start, end: start + text.length });
  }

  return result.sort((a, b) => a.start - b.start);
}
