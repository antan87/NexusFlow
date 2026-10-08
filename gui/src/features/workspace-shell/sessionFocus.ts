/**
 * Where keyboard focus goes when a session is closed from the list: the one above it, else the one below, so focus
 * is not dropped on the page. Null when it was the last one.
 */
export function sessionToFocusAfterClose(openTabs: readonly string[], closed: string): string | null {
  const index = openTabs.indexOf(closed);
  if (index === -1) return null;
  return openTabs[index - 1] ?? openTabs[index + 1] ?? null;
}

/** The attribute that marks a session's link in the sidebar, the open list and the rail alike. */
export const SESSION_LINK_ATTRIBUTE = 'data-sidebar-session';

/** Puts keyboard focus on a session's link in the sidebar. False when it is not on screen, such as a closed mobile sheet. */
export function focusSessionLink(branch: string): boolean {
  const link = document.querySelector<HTMLElement>(`[${SESSION_LINK_ATTRIBUTE}="${CSS.escape(branch)}"]`);
  link?.focus();
  return link !== null;
}
