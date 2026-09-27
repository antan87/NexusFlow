/**
 * Decides what a link inside rendered markdown may do. A raw `<a href>` is
 * never emitted for local paths: the app is a single page served from `/`, so
 * a file path such as `/home/me/workspace/shot.png` or `notes/a.md` resolves
 * against the app's own origin and replaces the whole app with a 404.
 */
export type MarkdownLinkTarget =
  | { kind: 'anchor'; id: string }
  | { kind: 'external'; href: string }
  | { kind: 'workspace-file'; path: string }
  | { kind: 'inert'; label: string };

export interface MarkdownLinkContext {
  /** Absolute workspace folder; absolute links inside it open in the app. */
  workspaceRoot?: string;
  /** Workspace-relative path (with `/`) of the document being rendered. */
  documentPath?: string;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function stripQueryAndFragment(value: string) {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

function toSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

function isAbsolutePath(value: string) {
  return value.startsWith('/') || WINDOWS_DRIVE.test(value);
}

/** Resolves `.`/`..` segments; returns null when the path climbs above the root. */
function normalizeRelative(segments: string[]): string | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join('/') : null;
}

function withinRoot(absolute: string, root: string): string | null {
  const normalizedRoot = toSlashes(root).replace(/\/+$/, '');
  if (!normalizedRoot) return null;
  // Windows paths compare case-insensitively; POSIX paths do not.
  const windows = WINDOWS_DRIVE.test(normalizedRoot + '/');
  const candidate = windows ? absolute.toLowerCase() : absolute;
  const prefix = (windows ? normalizedRoot.toLowerCase() : normalizedRoot) + '/';
  if (!candidate.startsWith(prefix)) return null;
  return normalizeRelative(absolute.slice(prefix.length).split('/'));
}

export function classifyMarkdownLink(rawHref: string | undefined | null, context?: MarkdownLinkContext): MarkdownLinkTarget {
  const href = (rawHref ?? '').trim();
  if (!href) return { kind: 'inert', label: '' };
  if (href.startsWith('#')) return { kind: 'anchor', id: decode(href.slice(1)) };
  if (href.startsWith('//')) return { kind: 'inert', label: href };

  let localPath = href;
  const scheme = WINDOWS_DRIVE.test(href) ? null : SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      try {
        const url = new URL(href);
        if ((scheme === 'mailto' || url.hostname) && !url.username && !url.password) return { kind: 'external', href: url.href };
      } catch { /* fall through */ }
      return { kind: 'inert', label: href };
    }
    if (scheme !== 'file') return { kind: 'inert', label: href };
    try {
      localPath = decode(new URL(href).pathname).replace(/^\/([a-z]:\/)/i, '$1');
    } catch {
      return { kind: 'inert', label: href };
    }
  }

  const label = decode(stripQueryAndFragment(localPath));
  if (!context) return { kind: 'inert', label };
  const target = toSlashes(label);

  let relative: string | null;
  if (isAbsolutePath(target)) {
    relative = context.workspaceRoot ? withinRoot(target, context.workspaceRoot) : null;
  } else {
    const documentDir = (context.documentPath ?? '').split('/').slice(0, -1);
    relative = normalizeRelative([...documentDir, ...target.split('/')]);
  }
  return relative ? { kind: 'workspace-file', path: relative } : { kind: 'inert', label };
}

/** GitHub-style heading slug so in-document `#anchor` links have a target. */
export function headingSlug(text: string) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}
