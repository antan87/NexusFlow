import { describe, expect, it } from 'vitest';

import type { MilestoneFact, ProgressFacts, WorkGuidance } from '../../types.js';
import { shouldReadThreads, threadSummary } from './chatThreads.js';

const milestone = (id: string, state: MilestoneFact['state'], title = id): MilestoneFact => ({ id, title, state }) as MilestoneFact;

function facts(overrides: Partial<ProgressFacts> = {}): ProgressFacts {
  const milestones = overrides.milestones ?? [milestone('m1', 'done'), milestone('m2', 'in_progress', 'Wire the reader')];
  const count = (state: string) => milestones.filter((entry) => entry.state === state).length;
  return {
    workspaceId: 'alpha',
    generatedAt: '2026-10-03T10:00:00.000Z',
    milestones,
    counts: { total: milestones.length, done: count('done'), inProgress: count('in_progress'), reopened: count('reopened'), blocked: count('blocked'), upcoming: count('upcoming') },
    currentMilestoneId: 'm2',
    openQuestions: [],
    changes: { repos: [], files: 0, additions: 0, deletions: 0 },
    verification: { status: 'never', freshness: 'unknown' },
    unavailable: [],
    ...overrides,
  };
}

const guidance = (objective: string): WorkGuidance => ({
  version: 1, revision: 1, workType: 'feature', size: 'standard', documents: [],
  assignment: { stage: 'implement', objective, expectedOutput: '', stopCondition: '' },
});

describe('threadSummary', () => {
  it('names the goal from the assignment first, then the current milestone, then the description', () => {
    expect(threadSummary({ branch: 'a', facts: facts(), guidance: guidance('Make the chat central'), description: 'old', waiting: false }).goal).toBe('Make the chat central');
    expect(threadSummary({ branch: 'a', facts: facts(), description: 'old', waiting: false }).goal).toBe('Wire the reader');
    expect(threadSummary({ branch: 'a', description: 'A rework of the chat\nwith a second line', waiting: false }).goal).toBe('A rework of the chat');
    expect(threadSummary({ branch: 'a', waiting: false }).goal).toBe('');
  });

  it('keeps a long goal to one short line', () => {
    const goal = threadSummary({ branch: 'a', guidance: guidance('x'.repeat(400)), waiting: false }).goal;
    expect(goal.length).toBeLessThanOrEqual(160);
    expect(goal.endsWith('...')).toBe(true);
  });

  it('says waiting for you when the AI has asked something, even when the plan says all done, and keeps the question to one line', () => {
    const done = facts({ milestones: [milestone('m1', 'done')], currentMilestoneId: undefined });
    expect(threadSummary({ branch: 'a', facts: done, waiting: true, question: 'Which format?\nCSV or JSON' }))
      .toMatchObject({ tone: 'needs', label: 'Waiting for you', finished: false, question: 'Which format?' });
    expect(threadSummary({ branch: 'a', facts: done, waiting: false, question: 'Stale question' }).question).toBe('');
  });

  it('is finished only when every milestone is done and nothing needs the developer', () => {
    const done = facts({ milestones: [milestone('m1', 'done'), milestone('m2', 'done')], currentMilestoneId: undefined });
    expect(threadSummary({ branch: 'a', facts: done, waiting: false })).toMatchObject({ tone: 'done', label: 'All done', finished: true });
    expect(threadSummary({ branch: 'a', facts: facts(), waiting: false }).finished).toBe(false);
    const reopened = facts({ milestones: [milestone('m1', 'done'), milestone('m2', 'reopened')] });
    expect(threadSummary({ branch: 'a', facts: reopened, waiting: false })).toMatchObject({ tone: 'reopened', finished: false });
  });

  it('does not guess a state while the facts are loading or could not be read', () => {
    expect(threadSummary({ branch: 'a', waiting: false })).toMatchObject({ tone: 'idle', label: '', finished: false });
    const unreadable = facts({ milestones: [], currentMilestoneId: undefined, unavailable: [{ source: 'milestones', reason: 'boom' }] });
    const summary = threadSummary({ branch: 'a', facts: unreadable, waiting: false });
    expect(summary.finished).toBe(false);
    expect(summary.label).toBe('Plan unavailable');
  });
});

describe('shouldReadThreads', () => {
  it('reads while the full sidebar is showing in a window that is being looked at', () => {
    expect(shouldReadThreads({ sidebarExpanded: true, windowAttentive: true })).toBe(true);
  });

  it('does not read for the rail, which shows no summaries', () => {
    expect(shouldReadThreads({ sidebarExpanded: false, windowAttentive: true })).toBe(false);
  });

  it('does not read in a window nobody is looking at', () => {
    expect(shouldReadThreads({ sidebarExpanded: true, windowAttentive: false })).toBe(false);
    expect(shouldReadThreads({ sidebarExpanded: false, windowAttentive: false })).toBe(false);
  });
});
