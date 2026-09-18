/**
 * Maps file extensions and filenames to Monaco Monarch language identifiers.
 * File: gui/src/features/changes/utils/languageDetector.ts
 */

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  toml: 'ini',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
};

export function getLanguageFromPath(filePath: string): string {
  if (!filePath) return 'plaintext';
  const cleanPath = filePath.split('?')[0]!.split('#')[0]!;
  const fileName = cleanPath.split(/[/\\]/).pop()?.toLowerCase() || '';

  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'package.json' || fileName === 'tsconfig.json') return 'json';

  const ext = fileName.split('.').pop() || '';
  return EXTENSION_MAP[ext] || 'plaintext';
}
