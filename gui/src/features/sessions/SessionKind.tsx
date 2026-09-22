import { GitBranch, MessageSquare } from 'lucide-react';
import type { AISession } from '../../types.js';

export function SessionKind({ session }: { session: AISession }) {
  const child = session.threadKind === 'subagent';
  const Icon = child ? GitBranch : MessageSquare;
  return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title={child ? 'A delegated agent task. Resume its main conversation to continue your work.' : session.threadKind === 'main' ? 'The main conversation you work in. It may delegate tasks to subagents.' : 'The harness has not provided a main/subagent classification.'}>
    <Icon className="size-3" aria-hidden="true" />{child ? 'Subagent' : session.threadKind === 'main' ? 'Main thread' : 'Conversation'}
  </span>;
}

export function mainSessionFor(session: AISession, sessions: AISession[]): AISession | undefined {
  let current: AISession | undefined = session;
  const visited = new Set<string>();
  while (current?.threadKind === 'subagent') {
    if (!current.parentSessionId || visited.has(current.id)) return undefined;
    visited.add(current.id);
    const parent: string = current.parentSessionId;
    current = sessions.find(s => s.assistant === session.assistant && s.id === parent);
  }
  return current;
}
