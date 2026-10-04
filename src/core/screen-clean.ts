/**
 * @module core/screen-clean
 * Makes text and references from an AI, a ledger or the screen safe to store and
 * show. Shared by the screen events and the opt-in screen context, so both
 * reject the same things: control characters, absolute or climbing paths, and
 * Git internals.
 */

import { cleanInputRequestText } from './attention.js';

/** Single-line text: cleaned, whitespace collapsed, cut to length. Undefined when nothing is left. */
export function cleanScreenText(value: unknown, max: number): string | undefined {
  const cleaned = cleanInputRequestText(value).replace(/\s+/g, ' ').slice(0, max).trim();
  return cleaned || undefined;
}

/** Multi-line text, such as a selection: control characters removed, line breaks kept, cut to length. */
export function cleanScreenBlock(value: unknown, max: number): string | undefined {
  // Line endings are normalised first: a lone carriage return would otherwise be stripped as a control character and join two lines.
  const cleaned = cleanInputRequestText(typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value).slice(0, max).trim();
  return cleaned || undefined;
}

/** Longest path accepted, in characters. */
export const SCREEN_REFERENCE_LIMIT = 1000;

/**
 * A relative path with forward slashes, or undefined when it is empty, absolute,
 * climbs out of its folder, or enters Git internals.
 */
export function cleanRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().replace(/\\/g, '/');
  // eslint-disable-next-line no-control-regex
  if (!raw || raw.length > SCREEN_REFERENCE_LIMIT || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return undefined;
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (!parts.length || parts.some((part) => part === '..' || part.toLowerCase() === '.git')) return undefined;
  return parts.join('/');
}

/** A repository name: text without path separators. */
export function cleanRepoName(value: unknown): string | undefined {
  const name = cleanScreenText(value, 200);
  return name && !/[\\/]/.test(name) ? name : undefined;
}

/** A 1-based line number, or undefined for anything else. */
export function cleanLineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000_000 ? value : undefined;
}
