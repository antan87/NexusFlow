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
  'vue', 'svelte', 'astro', 'md', 'in', 'it', 'to', 'so', 'pl', 'pm'
]);

const WEB_SCHEME = /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/i;
const IP_ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/;
const LOCALHOST = /^localhost(?::\d+)?(?:[/?#]|$)/i;
const WWW_DOMAIN = /^www\.[a-z\d.-]+/i;
const WEB_TLD = /\.(?:com|org|net|edu|gov|mil|int|info|biz|xyz|site|online|tech|store|blog|link|cloud)(?::\d+)?(?:[/?#]|$)/i;

export function normalizeWebUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
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
  if (WEB_SCHEME.test(trimmed)) return true;
  if (/^\/\//.test(trimmed)) return true;
  if (LOCALHOST.test(trimmed)) return true;
  if (IP_ADDRESS.test(trimmed)) return true;
  if (WWW_DOMAIN.test(trimmed)) return true;
  if (WEB_TLD.test(trimmed)) return true;

  const firstSegment = trimmed.split(/[/\\]/)[0];
  const host = firstSegment.split(':')[0].toLowerCase();
  if (host === 'localhost') return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  if (host.startsWith('www.')) return true;
  if (/\.(?:com|org|net|edu|gov|mil|int|info|biz|xyz|site|online|tech|store|blog|link|cloud)$/i.test(host)) return true;

  const parts = host.split('.');
  if (parts.length >= 2) {
    const tld = parts[parts.length - 1];
    if (!FILE_EXTS.has(tld)) return true;
    if (parts.length >= 3 && !trimmed.includes('/')) return true;
  }
  return false;
}

export function isPathInsideWorkspace(filePath: string, workspacePath: string, repoPaths?: string[]): boolean {
  const target = filePath.replace(/\\/g, '/').trim();
  if (!target) return false;
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
    if (covered.some(([s, e]) => (start >= s && start < e) || (end > s && end <= e))) continue;
    const text = lh[0];
    const url = normalizeWebUrl(text);
    result.push({ text, url, start, end });
  }

  return result.sort((a, b) => a.start - b.start);
}
