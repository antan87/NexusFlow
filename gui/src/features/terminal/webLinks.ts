import LinkifyIt from 'linkify-it';

export interface WebLink {
  text: string;
  url: string;
  start: number;
  end: number;
}

const linkify = new LinkifyIt().set({ fuzzyLink: true, fuzzyIP: true });

const FILE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'toml', 'yaml', 'yml',
  'css', 'scss', 'html', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico',
  'go', 'rs', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'sql', 'txt', 'lock', 'env', 'wasm', 'pdf', 'xml',
  'vue', 'svelte', 'astro', 'md', 'in', 'it', 'to', 'so', 'pl', 'pm',
  'log', 'conf', 'cfg', 'ini', 'proto', 'graphql', 'gql', 'swift', 'kt',
  'kts', 'scala', 'zig', 'nim', 'lua', 'dart', 'ex', 'exs', 'erl', 'clj',
  'hs', 'diff', 'patch', 'tar', 'gz', 'zip', 'csv', 'tsv'
]);

export function normalizeWebUrl(raw: string): string {
  let trimmed = raw.trim();
  while (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^(?:localhost|\d{1,3}\.\d{1,3})/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function isWebOrDomain(raw: string): boolean {
  let trimmed = raw.trim();
  while (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) return false;

  // Local file schemes are never web domains
  if (/^file:\/\//i.test(trimmed)) return false;

  // Relative or absolute filesystem path navigations are never web domains
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/') || /^[a-z]:[\\/]/i.test(trimmed)) {
    return false;
  }

  // Explicit web schemes or protocol-relative
  if (/^(?:https?:\/\/|mailto:|\/\/)/i.test(trimmed)) return true;

  // Localhost with optional port/path
  if (/^localhost(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) return true;

  // IPv4 with optional port/path
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(trimmed)) return true;

  // Starts with www.
  if (/^www\.[a-z\d.-]+/i.test(trimmed)) return true;

  // Use linkify to test against real IANA TLDs
  const matches = linkify.match(trimmed);
  if (!matches || matches.length === 0) return false;

  const first = matches[0];
  if (first.index !== 0) return false;

  if (first.schema === 'http:' || first.schema === 'https:' || first.schema === 'mailto:') {
    return true;
  }

  // Bare domain matching (fuzzy match, e.g. github.com/foo, example.com:8080)
  const host = first.raw.split(/[:/?#]/)[0].toLowerCase();
  const parts = host.split('.');
  if (parts.length >= 2) {
    const tld = parts[parts.length - 1];
    // If the TLD is also a known file extension (like .md, .sh, .py, .rs),
    // it is only a web link if it has a trailing path or query (e.g. docs.rs/tokio)
    const hasPath = /[/?]/.test(first.raw);
    if (FILE_EXTS.has(tld) && !hasPath) {
      return false;
    }
    return true;
  }

  return false;
}

export function isPathInsideWorkspace(filePath: string, workspacePath: string, repoPaths?: string[]): boolean {
  let target = filePath.replace(/\\/g, '/').trim();
  while (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }
  if (!target) return false;

  if (/^file:\/\//i.test(target)) {
    try {
      target = decodeURIComponent(new URL(target).pathname).replace(/^\/([a-z]:\/)/i, '$1');
    } catch {
      target = target.replace(/^file:\/\//i, '');
    }
  }

  const isAbsolute = target.startsWith('/') || /^[a-z]:\//i.test(target);
  if (!isAbsolute) {
    const segments = target.split('/');
    let depth = 0;
    for (const seg of segments) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        depth--;
        if (depth < 0) return false;
      } else {
        depth++;
      }
    }
    return true;
  }
  const roots = [workspacePath, ...(repoPaths ?? [])].filter(Boolean);
  for (const root of roots) {
    const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const isWindows = /^[a-z]:\//i.test(normRoot);
    const candidate = isWindows ? target.toLowerCase() : target;
    const prefix = (isWindows ? normRoot.toLowerCase() : normRoot) + '/';
    if (candidate === (isWindows ? normRoot.toLowerCase() : normRoot) || candidate.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function findWebLinks(row: string): WebLink[] {
  const result: WebLink[] = [];
  const covered: [number, number][] = [];

  const matches = linkify.match(row) || [];
  for (const match of matches) {
    if (match.schema === 'https:' || match.schema === 'http:' || match.schema === 'mailto:') {
      result.push({
        text: match.text,
        url: match.url,
        start: match.index,
        end: match.lastIndex,
      });
      covered.push([match.index, match.lastIndex]);
      continue;
    }
    if (match.raw.startsWith('www.')) {
      result.push({
        text: match.text,
        url: match.url,
        start: match.index,
        end: match.lastIndex,
      });
      covered.push([match.index, match.lastIndex]);
      continue;
    }
    const host = match.raw.split(/[:/]/)[0].toLowerCase();
    const parts = host.split('.');
    if (parts.length >= 2) {
      const tld = parts[parts.length - 1];
      if (FILE_EXTS.has(tld) && parts.length === 2 && !match.raw.includes('/')) {
        continue;
      }
      result.push({
        text: match.text,
        url: match.url,
        start: match.index,
        end: match.lastIndex,
      });
      covered.push([match.index, match.lastIndex]);
    }
  }

  const localhostRegex = /(?:https?:\/\/)?localhost(?::\d+)?(?:[/?#][^\s<>"'()]*[^\s<>"'().,:;?])?/gi;
  let lh: RegExpExecArray | null;
  while ((lh = localhostRegex.exec(row)) !== null) {
    const start = lh.index;
    const end = start + lh[0].length;
    if (covered.some(([s, e]) => start < e && end > s)) continue;
    const text = lh[0];
    const url = normalizeWebUrl(text);
    result.push({ text, url, start, end });
  }

  return result.sort((a, b) => a.start - b.start);
}
