/**
 * What each open chat says about itself: what it is working on, and whether it needs the developer. Pure, so the
 * rules can be tested without a DOM. The words are the developer's own (the assignment's objective, the workspace
 * description) or the plan's milestone title; the state comes from the same facts as the Where Are We strip, so a
 * tab and the strip never disagree.
 */

import type { ProgressFacts, WorkGuidance } from '../../types.js';
import { goalLine, stripState, type StripTone } from '../progress/progressView.js';

const GOAL_LIMIT = 160;

export interface ThreadSummary {
  branch: string;
  /** What the chat is working on. Empty when nothing says. */
  goal: string;
  tone: StripTone;
  /** The state in words. Empty while the facts are still loading. */
  label: string;
  /** Every milestone is done and nothing needs the developer: time to review and finish. */
  finished: boolean;
}

export interface ThreadInput {
  branch: string;
  facts?: ProgressFacts;
  guidance?: WorkGuidance;
  /** The workspace's own description, used when neither the assignment nor the plan names a goal. */
  description?: string;
  /** The AI has asked the developer something and is waiting in this chat. */
  waiting: boolean;
}

const oneLine = (text: string) => {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? '';
  return line.length <= GOAL_LIMIT ? line : `${line.slice(0, GOAL_LIMIT - 3).trimEnd()}...`;
};

export function threadSummary({ branch, facts, guidance, description, waiting }: ThreadInput): ThreadSummary {
  const goal = oneLine(goalLine(guidance, facts).text) || oneLine(description ?? '');
  if (waiting) return { branch, goal, tone: 'needs', label: 'Waiting for you', finished: false };
  if (!facts) return { branch, goal, tone: 'idle', label: '', finished: false };
  const state = stripState(facts);
  return { branch, goal, tone: state.tone, label: state.label, finished: state.tone === 'done' };
}

/** What needs the developer comes first, finished work last. */
const RANK: Record<StripTone, number> = { needs: 0, reopened: 1, ai: 2, idle: 3, done: 4 };

/** The list order: by what needs attention, and in the order the chats were opened within each group. */
export function sortThreads<T extends { tone: StripTone }>(threads: readonly T[]): T[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => RANK[a.thread.tone] - RANK[b.thread.tone] || a.index - b.index)
    .map(({ thread }) => thread);
}

/** One line for a screen reader or a tooltip: "Goal. State." with whichever parts exist. */
export function threadNote(summary: Pick<ThreadSummary, 'goal' | 'label'>): string {
  return [summary.goal, summary.label].filter(Boolean).join('. ');
}
