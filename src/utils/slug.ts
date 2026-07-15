/**
 * @module utils/slug
 * The shared "human name → registry id" rule. Used for project ids,
 * workflow-template ids, and in-place workspace directory names — kept in one
 * place so ids computed by different subsystems always match.
 */

/**
 * Lowercases, keeps alphanumerics, and collapses everything else to single
 * hyphens (trimmed at both ends). Returns '' when nothing usable remains.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
