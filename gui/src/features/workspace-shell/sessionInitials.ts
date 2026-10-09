/**
 * The letters that tell a session apart in the narrow rail, where there is no room for its name: the first letters of
 * its first two words, or the first two characters of a single word. Words are split at spaces, hyphens, underscores,
 * slashes and dots, so a branch name works as well as a title.
 */
export function sessionInitials(name: string): string {
  const words = name.split(/[\s\-_/.]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length >= 2 ? `${[...words[0]!][0]}${[...words[1]!][0]}` : [...words[0]!].slice(0, 2).join('');
  return letters.toUpperCase();
}
