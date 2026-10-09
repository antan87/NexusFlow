/**
 * Reading a file reference the way a CLI or a document writes one: `src/app.ts:12`, `src/app.ts:12:3`,
 * `src/app.ts(12,3)`, `docs/guide.md#L20-L30`, `file:///home/me/repo/app.ts`, wrapped in `<…>`, in
 * a markdown link, or followed by sentence punctuation. Every place that turns such text into a
 * path uses this, so a link that works in one place works in all of them.
 */
export interface FileLocation {
  path: string;
  line?: number;
  column?: number;
}

const LOCATION_SUFFIXES: readonly RegExp[] = [
  /:(\d+)(?::(\d+))?$/,
  /\((\d+)(?:,(\d+))?\)$/,
  /#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i,
];

const positive = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

/**
 * Drops punctuation that ends the sentence around a path (`see src/app.ts.` or `(src/app.ts)`),
 * but keeps a `(12,3)` location and a Windows drive letter's colon.
 */
export function trimTrailingPunctuation(text: string): string {
  let result = text;
  while (
    (/[,'"`\]};.!?)>]$/.test(result) || (result.endsWith(':') && !/^[a-zA-Z]:$/.test(result)))
    && !/\(\d+(?:,\d+)?\)$/.test(result)
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

/** Splits a trailing line (and column) location off a path. */
export function splitLocation(text: string): FileLocation {
  for (const pattern of LOCATION_SUFFIXES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const line = positive(match[1]);
    if (line === undefined) continue;
    return { path: text.slice(0, -match[0].length), line, column: positive(match[2]) };
  }
  return { path: text };
}

/** A `file://` URL as the filesystem path it names; any other text unchanged. */
export function fileUrlToPath(text: string): string {
  if (!/^file:\/\//i.test(text)) return text;
  try {
    return decodeURIComponent(new URL(text).pathname).replace(/^\/([a-z]:\/)/i, '$1');
  } catch {
    return text.replace(/^file:\/\//i, '');
  }
}

function unwrap(text: string): string {
  let result = text.trim();
  while (result.startsWith('<') && result.endsWith('>')) result = result.slice(1, -1).trim();
  return result;
}

/**
 * The path and location a piece of clicked or printed text names, or null when nothing is left
 * once the decoration is removed. It does not decide whether the path exists or is a web address.
 */
export function parseFileReference(raw: string): FileLocation | null {
  let text = unwrap(raw);
  // Matched before and after trimming: `[a](b)` must keep its own closing parenthesis, `[a](b).` loses the dot.
  const markdownLink = /^\[[^\]]*\]\((<[^>]+>|[^)]+)\)$/;
  const markdown = markdownLink.exec(text) ?? markdownLink.exec(text.replace(/[,.;:!?]+$/, ''));
  if (markdown) text = unwrap(markdown[1]!);
  text = trimTrailingPunctuation(unwrap(text)).trim();
  // A file URL may carry its location as a fragment (`file:///x.ts#L12`), so it is split first.
  const location = splitLocation(text);
  const path = fileUrlToPath(location.path).replace(/#.*$/, '').trim();
  if (!path) return null;
  return { path, ...(location.line ? { line: location.line } : {}), ...(location.column ? { column: location.column } : {}) };
}
