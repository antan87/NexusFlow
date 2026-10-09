/** What the server did not send for a file, and why. */
export interface OmittedContent {
  content?: 'binary' | 'too-large';
  diff?: boolean;
}

/**
 * The line shown above a file whose full text, or whose diff, was not loaded, so
 * the viewer does not pass off the changed lines as the whole file.
 */
export function omittedNotice(omitted: OmittedContent | undefined): string | null {
  if (!omitted) return null;
  if (omitted.diff) return 'This diff is too large to display. Open the file in your editor to review it.';
  if (omitted.content === 'binary') return 'This is a binary file, so there is no text to show. Git\'s summary of the change is below.';
  if (omitted.content === 'too-large') return 'This file is too large to load in full, so only the changed lines are shown.';
  return null;
}
