import {
  Braces,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Hash,
  Palette,
  ScrollText,
  Table,
  Boxes,
  Cog,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

/**
 * A file-type glyph, chosen so the tree is scannable by shape and colour
 * rather than by reading the extension. Every entry maps an extension to a
 * lucide icon and a hue from the app palette.
 */
export interface FileTypeGlyph {
  icon: LucideIcon;
  /** Tailwind text colour applied to the icon. */
  className: string;
  /** Spoken label, so the icon is not the only signal. */
  label: string;
}

const GLYPHS: Record<string, FileTypeGlyph> = {
  ts: { icon: FileType, className: 'text-sky-400', label: 'TypeScript' },
  tsx: { icon: FileType, className: 'text-sky-400', label: 'TypeScript React' },
  mts: { icon: FileType, className: 'text-sky-400', label: 'TypeScript' },
  cts: { icon: FileType, className: 'text-sky-400', label: 'TypeScript' },
  js: { icon: FileCode, className: 'text-amber-400', label: 'JavaScript' },
  mjs: { icon: FileCode, className: 'text-amber-400', label: 'JavaScript' },
  cjs: { icon: FileCode, className: 'text-amber-400', label: 'JavaScript' },
  jsx: { icon: FileCode, className: 'text-amber-400', label: 'JavaScript React' },
  json: { icon: FileJson, className: 'text-yellow-400', label: 'JSON' },
  jsonc: { icon: FileJson, className: 'text-yellow-400', label: 'JSON' },
  yml: { icon: Hash, className: 'text-rose-400', label: 'YAML' },
  yaml: { icon: Hash, className: 'text-rose-400', label: 'YAML' },
  toml: { icon: Hash, className: 'text-rose-400', label: 'TOML' },
  md: { icon: FileText, className: 'text-slate-300', label: 'Markdown' },
  mdx: { icon: FileText, className: 'text-slate-300', label: 'MDX' },
  txt: { icon: FileText, className: 'text-slate-300', label: 'Text' },
  rst: { icon: ScrollText, className: 'text-slate-300', label: 'reStructuredText' },
  css: { icon: Palette, className: 'text-pink-400', label: 'CSS' },
  scss: { icon: Palette, className: 'text-pink-400', label: 'SCSS' },
  less: { icon: Palette, className: 'text-pink-400', label: 'Less' },
  html: { icon: FileCode, className: 'text-orange-400', label: 'HTML' },
  svg: { icon: FileImage, className: 'text-purple-400', label: 'SVG' },
  png: { icon: FileImage, className: 'text-purple-400', label: 'Image' },
  jpg: { icon: FileImage, className: 'text-purple-400', label: 'Image' },
  jpeg: { icon: FileImage, className: 'text-purple-400', label: 'Image' },
  gif: { icon: FileImage, className: 'text-purple-400', label: 'Image' },
  webp: { icon: FileImage, className: 'text-purple-400', label: 'Image' },
  ico: { icon: FileImage, className: 'text-purple-400', label: 'Icon' },
  sh: { icon: Terminal, className: 'text-emerald-400', label: 'Shell script' },
  bash: { icon: Terminal, className: 'text-emerald-400', label: 'Shell script' },
  zsh: { icon: Terminal, className: 'text-emerald-400', label: 'Shell script' },
  ps1: { icon: Terminal, className: 'text-emerald-400', label: 'PowerShell script' },
  sql: { icon: Table, className: 'text-cyan-400', label: 'SQL' },
  graphql: { icon: Braces, className: 'text-pink-300', label: 'GraphQL' },
  prisma: { icon: Boxes, className: 'text-indigo-400', label: 'Prisma schema' },
  lock: { icon: FileJson, className: 'text-slate-400', label: 'Lock file' },
  env: { icon: Cog, className: 'text-yellow-500', label: 'Environment file' },
};

const FALLBACK: FileTypeGlyph = { icon: FileCode, className: 'text-muted-foreground', label: 'File' };

/** Extension-based glyph lookup. Dotfiles such as `.gitignore` resolve by name. */
export function fileTypeGlyph(path: string): FileTypeGlyph {
  const name = path.split('/').at(-1) ?? path;
  if (name.startsWith('.')) {
    if (name === '.gitignore' || name === '.npmignore') return { icon: FileType, className: 'text-orange-400', label: 'Ignore file' };
    if (name === '.env' || name.startsWith('.env.')) return GLYPHS.env;
    if (name === '.editorconfig') return { icon: Cog, className: 'text-slate-400', label: 'Editor config' };
  }
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return GLYPHS[extension] ?? FALLBACK;
}
