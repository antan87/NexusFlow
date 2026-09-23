export interface FileReference { text: string; path: string; line?: number; start: number; end: number }

/** Find file paths in terminal output, retaining spaces inside quoted paths. */
export function findFileReferences(row: string): FileReference[] {
  const result: FileReference[] = [];
  for (let index = 0; index < row.length;) {
    if (/\s/.test(row[index])) { index++; continue; }
    const tokenStart = index;
    let quote: '"' | "'" | '`' | null = null;
    while (index < row.length) {
      const char = row[index];
      if (quote && char === quote) quote = null;
      else if (!quote && (char === '"' || char === "'" || char === '`') && /^[([{]*$/.test(row.slice(tokenStart, index))) quote = char;
      else if (/\s/.test(char) && !quote) break;
      index++;
    }
    const token = row.slice(tokenStart, index);
    const leading = token.match(/^[('"`[{]*/)?.[0].length ?? 0;
    let text = token.slice(leading);
    while (/[,'"`\]};.!?)]$/.test(text) && !/\(\d+(?:,\d+)?\)$/.test(text)) text = text.slice(0, -1);
    const location = text.match(/:(\d+)(?::\d+)?$/) ?? text.match(/\((\d+)(?:,\d+)?\)$/);
    const lineNumber = Number(location?.[1]);
    const line = Number.isSafeInteger(lineNumber) && lineNumber > 0 ? lineNumber : undefined;
    const path = (location ? text.slice(0, -location[0].length) : text).replace(/['"`]$/, '');
    if (!path || /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/i.test(path)) continue;
    if (!/[/\\]/.test(path) && !/^[^.:]+\.[a-z\d]{1,12}$/i.test(path)) continue;
    if (/^(?:\.\.?[/\\])?$/.test(path)) continue;
    const start = tokenStart + leading;
    result.push({ text, path, line, start, end: start + text.length });
  }
  return result;
}
