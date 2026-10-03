import type { NavigateFunction } from 'react-router-dom';

/** Where a workspace's chat is. The address is the source of truth for which chat is on screen. */
export const chatPath = (branchName: string) => `/workspaces/${encodeURIComponent(branchName)}/chat`;

/**
 * Whether the address already shows this workspace's chat: its chat section, or no
 * section at all, which opens the chat. Going there again would only change the
 * address under the user for nothing.
 */
export function showsChatOf(pathname: string, branchName: string): boolean {
  const base = `/workspaces/${encodeURIComponent(branchName)}`;
  const path = pathname.replace(/\/+$/, '');
  return path === base || path === `${base}/chat`;
}

/**
 * The dock moves the address to a chat when the user chooses one, and the address
 * then tells the page which chat that is. The two do not happen at the same moment:
 * the browser's address changes at once, but the app applies its own copy of the
 * location a little later when the page is busy. The user can act in between, say by
 * opening two chats and closing the second, and what they did last has to win.
 *
 * So every navigation the dock makes is numbered, and when one lands the page asks
 * which kind it is: one the user made some other way (a typed address, a link,
 * Back), one the dock made that a newer one has since replaced, or the newest one
 * the dock made. Only the newest acts. An older one is out of date, and one for a
 * chat the user has since closed is corrected rather than obeyed.
 */
let issued = Date.now();
// Numbers left in history by an earlier visit are older than this, so they never count as new.
let handled = issued;

export interface DockNavigationState { chatDock: number }

/** The number for the next navigation the dock makes. */
export function dockNavigationState(): DockNavigationState {
  issued += 1;
  return { chatDock: issued };
}

export type DockLanding = 'external' | 'stale' | 'current';

/**
 * What a landing is. Each numbered landing is judged once: after it, the same number,
 * or any older one arriving late, counts as external because it is no longer news.
 */
export function judgeDockLanding(state: unknown): DockLanding {
  const mark = (state as Partial<DockNavigationState> | null | undefined)?.chatDock;
  if (typeof mark !== 'number' || !Number.isFinite(mark) || mark <= handled) return 'external';
  handled = mark;
  return mark < issued ? 'stale' : 'current';
}

/**
 * The address the browser is at now. Unlike the router's own copy, it changes the moment a
 * navigation is made, so it says where the user is going, not where the page last rendered.
 */
export function browserPath(hash: string = typeof window === 'undefined' ? '' : window.location.hash): string {
  return hash.replace(/^#/, '').split(/[?#]/)[0] ?? '';
}

/** Goes to a workspace's chat as the dock: marked, so its landing can be told from the user's own. */
export function goToChat(navigate: NavigateFunction, branchName: string, options: { replace?: boolean } = {}): void {
  navigate(chatPath(branchName), { replace: options.replace ?? false, state: dockNavigationState() });
}
