import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { chatDockSlot } from './dockPlacement.js';
import { goToWorkspace, judgeDockLanding, type DockLanding } from './chatRoute.js';
import { floatingChatStore } from './floatingChatStore.js';

/**
 * The Chat destination. It is an empty box: the chat itself lives above the router
 * and lays itself over this box, so it survives leaving the destination. Being here
 * for a workspace makes that workspace's chat the active tab, opening the tab first
 * if it is not there, so a link or a reload always lands on the right chat.
 *
 * The workspace comes from the route, not from the page's state, which is set a
 * render later: the address and the workspace it names are always read together.
 *
 * Two cases are not obeyed, because the address is out of date, not the user. A
 * navigation the dock made that a newer one has replaced is ignored. And when the
 * newest one is for a chat the user has closed since, it is moved on to the chat they
 * are on, instead of reopening what they closed.
 */
export function ChatDockSlot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId, tab } = useParams();
  // A landing is judged once. The verdict is kept so that running the effect again for the same landing
  // (as development mode does on mount) reaches the same answer instead of seeing it as already taken.
  const judged = useRef<{ key: string; landing: DockLanding } | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    if (judged.current?.key !== location.key) judged.current = { key: location.key, landing: judgeDockLanding(location.state) };
    const { landing } = judged.current;
    if (landing === 'stale') return;
    const { openTabs, activeTab } = floatingChatStore.getState();
    if (landing === 'current' && !openTabs.includes(workspaceId)) {
      // The part open beside the chat stays open for the chat the user is on.
      if (activeTab && activeTab !== workspaceId) goToWorkspace(navigate, activeTab, tab ?? 'chat', { replace: true });
      return;
    }
    floatingChatStore.reveal(workspaceId);
  }, [workspaceId, tab, location.key, location.state, navigate]);
  // Stable, so React does not detach and reattach the slot on every render, which would hide the dock for a moment.
  const attach = useCallback((element: HTMLDivElement | null) => { chatDockSlot.set(element); }, []);
  return <div ref={attach} data-testid="chat-dock-slot" className="h-full min-h-0 w-full" />;
}
