import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { Spinner } from '../../components/ui/spinner.js';
import type { Feature } from '../../types.js';
import { chatHomeTarget } from './chatHome.js';
import { chatPath } from './chatRoute.js';
import { useFloatingChat } from './floatingChatStore.js';

/** The app's front door. It opens on the chat the user was last in, and on `fallback` (the overview) when there is none. */
export function ChatHome({ workspaces, loading, ready, fallback }: { workspaces: readonly Feature[]; loading: boolean; ready: boolean; fallback: ReactNode }) {
  const { activeTab, openTabs } = useFloatingChat();
  // Before the app is set up there is nothing to open, and the fallback is where setup happens.
  if (!ready) return <>{fallback}</>;
  if (loading) return <div className="grid h-full place-items-center"><Spinner className="size-6" /></div>;
  const target = chatHomeTarget(activeTab, openTabs, workspaces.map((workspace) => workspace.branchName));
  return target ? <Navigate to={chatPath(target)} replace /> : <>{fallback}</>;
}
