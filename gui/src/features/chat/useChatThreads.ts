import { useOpenChatFacts } from '../../lib/api/queries.js';
import type { Feature, ProgressFacts } from '../../types.js';
import { threadSummary, type ThreadSummary } from './chatThreads.js';
import { useFloatingChat } from './floatingChatStore.js';
import { useChatAttention } from './useChatAttention.js';

/**
 * What every open chat is working on and where it stands, for the sidebar's open sessions.
 * Whoever shows it decides when it is read (`read`, see `shouldReadThreads`); with `read` off it is what was last read.
 */
export function useChatThreads(workspaces: readonly Feature[], read: boolean): {
  summaries: ReadonlyMap<string, ThreadSummary>;
  facts: ReadonlyMap<string, ProgressFacts | undefined>;
} {
  const { openTabs } = useFloatingChat();
  const { open } = useChatAttention();
  const questions = new Map(open.map((request) => [request.workspaceId, request.message] as const));
  const data = useOpenChatFacts(openTabs, read);
  const byBranch = new Map(workspaces.map((workspace) => [workspace.branchName, workspace]));
  const summaries = new Map(openTabs.map((branch) => [branch, threadSummary({
    branch, facts: data.facts.get(branch), guidance: data.guidance.get(branch),
    description: byBranch.get(branch)?.description, waiting: questions.has(branch), question: questions.get(branch),
  })] as const));
  return { summaries, facts: data.facts };
}
