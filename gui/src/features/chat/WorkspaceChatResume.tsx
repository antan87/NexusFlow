import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { harnessName } from '../../components/icons/HarnessIcon.js';
import { useFloatingChat } from './floatingChatStore.js';
import { useWorkspaceSessionSources } from '../terminal/useWorkspaceSessionSources.js';

export function WorkspaceChatResume({ workspace }: { workspace: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const { openTabs, openCli } = useFloatingChat();
  const hasTab = openTabs.includes(workspace);

  useEffect(() => {
    if (inView) return;
    const node = container.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  const { sessions, sourcesPending, sourcesFailed } = useWorkspaceSessionSources(workspace, inView && !hasTab);
  const recent = sessions.filter(session => session.threadKind !== 'subagent')
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0];
  const details = hasTab
    ? 'CLI chat tab open'
    : recent
      ? `Last chat: ${harnessName(recent.assistant)} · ${recent.title}`
      : !inView || sourcesPending > 0
        ? 'Finding recent chats…'
        : sourcesFailed > 0
          ? 'Recent chats unavailable'
          : 'No saved chat yet';
  const actionLabel = hasTab
    ? `Open existing CLI chat tab for ${workspace}`
    : recent
      ? `Open CLI chat for ${workspace}; recent conversation: ${recent.title}`
      : `Open CLI chat for ${workspace}`;

  return <div ref={container} className="flex w-full min-w-0 items-center gap-1.5">
    <Button size="icon-sm" variant="ghost" onClick={() => openCli(workspace)} aria-label={actionLabel} title={actionLabel} className="shrink-0 text-primary">
      <History size={14} aria-hidden="true" />
    </Button>
    <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={details} aria-live="polite">{details}</span>
  </div>;
}
