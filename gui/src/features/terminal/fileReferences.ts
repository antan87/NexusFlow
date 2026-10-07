import { isWebOrDomain } from './webLinks.js';

export interface FileReference { text: string; path: string; line?: number; start: number; end: number }

const MARKDOWN_LINK = /\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g;

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

    let text = raw;
    while (/[,'"`\]};.!?)}>]$/.test(text) && !/\(\d+(?:,\d+)?\)$/.test(text)) text = text.slice(0, -1);
    const location = text.match(/:(\d+)(?::\d+)?$/) ?? text.match(/\((\d+)(?:,\d+)?\)$/);
    const lineNumber = Number(location?.[1]);
    const line = Number.isSafeInteger(lineNumber) && lineNumber > 0 ? lineNumber : undefined;
    let path = (location ? text.slice(0, -location[0].length) : text).replace(/['"`>]$/, '');
    if (/^file:\/\//i.test(path)) {
      try {
        path = decodeURIComponent(new URL(path).pathname).replace(/^\/([a-z]:\/)/i, '$1');
      } catch {
        path = path.replace(/^file:\/\//i, '');
      }
    }
    if (!path || isWebOrDomain(path)) continue;
    if (!/[/\\]/.test(path) && !/^[^.:]+(?:\.[a-z\d_-]+)*\.[a-z][a-z\d]{0,11}$/i.test(path)) continue;
    if (/^(?:\.\.?[/\\])?$/.test(path)) continue;

    const targetOffset = match[0].indexOf(match[2]) + (unwrapped ? 1 : 0);
    const start = matchStart + targetOffset;
    result.push({ text, path, line, start, end: start + text.length });
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
    let text = token.slice(leading);
    while (/[,'"`\]};.!?)}>]$/.test(text) && !/\(\d+(?:,\d+)?\)$/.test(text)) text = text.slice(0, -1);
    const location = text.match(/:(\d+)(?::\d+)?$/) ?? text.match(/\((\d+)(?:,\d+)?\)$/);
    const lineNumber = Number(location?.[1]);
    const line = Number.isSafeInteger(lineNumber) && lineNumber > 0 ? lineNumber : undefined;
    let path = (location ? text.slice(0, -location[0].length) : text).replace(/['"`>]$/, '');
    if (/^file:\/\//i.test(path)) {
      try {
        path = decodeURIComponent(new URL(path).pathname).replace(/^\/([a-z]:\/)/i, '$1');
      } catch {
        path = path.replace(/^file:\/\//i, '');
      }
    }
    if (!path || isWebOrDomain(path)) continue;
    if (!/[/\\]/.test(path) && !/^[^.:]+(?:\.[a-z\d_-]+)*\.[a-z][a-z\d]{0,11}$/i.test(path)) continue;
    if (/^(?:\.\.?[/\\])?$/.test(path)) continue;
    const start = tokenStart + leading;
    result.push({ text, path, line, start, end: start + text.length });
  }

  return result.sort((a, b) => a.start - b.start);
}
