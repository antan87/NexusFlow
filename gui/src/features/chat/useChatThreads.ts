import { useOpenChatFacts } from '../../lib/api/queries.js';
import type { Feature, ProgressFacts } from '../../types.js';
import { threadSummary, type ThreadSummary } from './chatThreads.js';
import { useFloatingChat } from './floatingChatStore.js';
import { useChatAttention } from './useChatAttention.js';

/**
 * What every open chat is working on and where it stands, for the chat's tabs, its list of chats and the sidebar.
 * Only the chat reads (`read`), and only while it is on screen; everyone else is shown what it last read.
 */
export function useChatThreads(workspaces: readonly Feature[], read: boolean): {
  summaries: ReadonlyMap<string, ThreadSummary>;
  facts: ReadonlyMap<string, ProgressFacts | undefined>;
} {
  const { openTabs } = useFloatingChat();
  const { waiting } = useChatAttention();
  const data = useOpenChatFacts(openTabs, read);
  const byBranch = new Map(workspaces.map((workspace) => [workspace.branchName, workspace]));
  const summaries = new Map(openTabs.map((branch) => [branch, threadSummary({
    branch, facts: data.facts.get(branch), guidance: data.guidance.get(branch),
    description: byBranch.get(branch)?.description, waiting: waiting.has(branch),
  })] as const));
  return { summaries, facts: data.facts };
}
