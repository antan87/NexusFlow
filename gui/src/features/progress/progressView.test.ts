import { describe, expect, it } from 'vitest';

import type { MilestoneFact, ProgressFacts, ScreenEvent, WorkGuidance } from '../../types';
import {
  activeProposals, checkIsFailing, currentMilestoneIndex, factsLine, formatAge, goalLine, latestNext, nextAction, ringMilestones, stripState, verificationLine,
} from './progressView';

const milestone = (id: string, state: MilestoneFact['state'], extra: Partial<MilestoneFact> = {}): MilestoneFact =>
  ({ id, title: `Title ${id}`, state, verified: false, reopenCount: 0, waitingOn: [], ...extra });

function facts(milestones: MilestoneFact[] = [], extra: Partial<ProgressFacts> = {}): ProgressFacts {
  const count = (state: MilestoneFact['state']) => milestones.filter((m) => m.state === state).length;
  return {
    workspaceId: 'demo', generatedAt: '2026-10-02T12:00:00.000Z', milestones,
    counts: { total: milestones.length, done: count('done'), inProgress: count('in_progress'), reopened: count('reopened'), blocked: count('blocked'), upcoming: count('upcoming') },
    openQuestions: [], changes: { repos: [], files: 0, additions: 0, deletions: 0 },
    verification: { status: 'never', freshness: 'unknown' }, unavailable: [], ...extra,
  };
}

const question = (message = 'Which cache?') => ({ id: 'q1', timestamp: '2026-10-02T11:00:00.000Z', harness: 'claude', message });
const unavailable = (source: ProgressFacts['unavailable'][number]['source']) => [{ source, reason: 'cannot read' }];

let counter = 0;
const next = (title: string, timestamp: string, extra: Record<string, unknown> = {}): ScreenEvent =>
  ({ id: `n${++counter}`, timestamp, harness: 'claude', event: 'next', payload: { title, reason: `because ${title}`, ...extra } }) as ScreenEvent;
const proposal = (stepId: string, kind: 'reopen' | 'complete', timestamp: string, reason = 'it looks wrong'): ScreenEvent =>
  ({ id: `p${++counter}`, timestamp, harness: 'claude', event: 'milestone_proposal', payload: { stepId, proposal: kind, reason } }) as ScreenEvent;

describe('ringMilestones and currentMilestoneIndex', () => {
  it('maps milestones in plan order with their titles and never adds a fraction', () => {
    expect(ringMilestones(facts([milestone('a', 'done'), milestone('b', 'reopened')]))).toEqual([
      { state: 'done', title: 'Title a' }, { state: 'reopened', title: 'Title b' },
    ]);
  });

  it('gives no ring for no facts', () => {
    expect(ringMilestones(undefined)).toEqual([]);
  });

  it('finds the current milestone, and says nothing when it is not in the plan', () => {
    const plan = [milestone('a', 'done'), milestone('b', 'in_progress')];
    expect(currentMilestoneIndex(facts(plan, { currentMilestoneId: 'b' }))).toBe(1);
    expect(currentMilestoneIndex(facts(plan, { currentMilestoneId: 'gone' }))).toBeUndefined();
    expect(currentMilestoneIndex(facts(plan))).toBeUndefined();
    expect(currentMilestoneIndex(undefined)).toBeUndefined();
  });
});

describe('stripState', () => {
  it('puts what needs the developer first: a question beats everything', () => {
    const state = stripState(facts([milestone('a', 'blocked'), milestone('b', 'reopened')], { openQuestions: [question()], verification: { status: 'fail', freshness: 'fresh' } }));
    expect(state).toEqual({ tone: 'needs', label: 'Needs you' });
  });

  it('then a blocked milestone, then a failing check, then reopened work', () => {
    expect(stripState(facts([milestone('a', 'blocked'), milestone('b', 'reopened')]))).toEqual({ tone: 'needs', label: 'Blocked' });
    expect(stripState(facts([milestone('b', 'reopened')], { verification: { status: 'fail', freshness: 'fresh' } }))).toEqual({ tone: 'needs', label: 'Check failing' });
    expect(stripState(facts([milestone('b', 'reopened'), milestone('c', 'in_progress')]))).toEqual({ tone: 'reopened', label: 'Reopened' });
  });

  it('shows in progress, all done, not started and no plan', () => {
    expect(stripState(facts([milestone('a', 'done'), milestone('b', 'in_progress')]))).toEqual({ tone: 'ai', label: 'In progress' });
    expect(stripState(facts([milestone('a', 'done'), milestone('b', 'done')]))).toEqual({ tone: 'done', label: 'All done' });
    expect(stripState(facts([milestone('a', 'done'), milestone('b', 'upcoming')]))).toEqual({ tone: 'idle', label: 'Not started' });
    expect(stripState(facts([]))).toEqual({ tone: 'idle', label: 'No plan yet' });
  });

  it('does not call an old failure a failing check once the code has changed since', () => {
    expect(stripState(facts([milestone('a', 'done')], { verification: { status: 'fail', freshness: 'stale' } })).label).toBe('All done');
    // When freshness cannot be told, a failure still counts: better a false alarm than a hidden one.
    expect(stripState(facts([milestone('a', 'done')], { verification: { status: 'timeout', freshness: 'unknown' } })).label).toBe('Check failing');
  });

  it('never reads facts from a source that could not be read', () => {
    expect(stripState(facts([], { unavailable: unavailable('milestones') }))).toEqual({ tone: 'idle', label: 'Plan unavailable' });
    expect(stripState(facts([milestone('a', 'done')], { openQuestions: [question()], unavailable: unavailable('questions') })).label).toBe('All done');
    expect(checkIsFailing(facts([], { verification: { status: 'fail', freshness: 'fresh' }, unavailable: unavailable('verification') }))).toBe(false);
  });
});

describe('factsLine', () => {
  it('gives the facts that carry news, in a fixed order', () => {
    const line = factsLine(facts([milestone('a', 'done'), milestone('b', 'in_progress'), milestone('c', 'upcoming')], {
      openQuestions: [question(), { ...question(), id: 'q2' }],
      changes: { repos: [], files: 7, additions: 10, deletions: 2 },
      verification: { status: 'pass', freshness: 'fresh' },
    }));
    expect(line).toEqual(['1 of 3 done', '2 questions', '7 files changed', 'checks passed']);
  });

  it('uses the singular for one, and leaves out zeros and checks that never ran', () => {
    expect(factsLine(facts([milestone('a', 'upcoming')], { openQuestions: [question()], changes: { repos: [], files: 1, additions: 1, deletions: 0 } })))
      .toEqual(['0 of 1 done', '1 question', '1 file changed']);
    expect(factsLine(facts([]))).toEqual([]);
  });

  it('says when a check is out of date, failed or timed out', () => {
    expect(factsLine(facts([], { verification: { status: 'pass', freshness: 'stale' } }))).toEqual(['checks passed, code changed since']);
    expect(factsLine(facts([], { verification: { status: 'fail', freshness: 'fresh' } }))).toEqual(['checks failed']);
    expect(factsLine(facts([], { verification: { status: 'timeout', freshness: 'stale' } }))).toEqual(['checks timed out, code changed since']);
    expect(factsLine(facts([], { verification: { status: 'skipped', freshness: 'unknown' } }))).toEqual([]);
  });

  it('leaves out a fact whose source could not be read instead of showing a zero', () => {
    const line = factsLine(facts([milestone('a', 'done')], {
      changes: { repos: [], files: 0, additions: 0, deletions: 0 },
      unavailable: [...unavailable('changes'), ...unavailable('milestones'), ...unavailable('verification'), ...unavailable('questions')],
      verification: { status: 'pass', freshness: 'fresh' }, openQuestions: [question()],
    }));
    expect(line).toEqual([]);
  });
});

describe('goalLine', () => {
  const guidance = (objective: string): WorkGuidance => ({
    version: 1, revision: 0, workType: 'feature', size: 'standard', documents: [],
    assignment: { stage: 'implement', objective, expectedOutput: '', stopCondition: '' },
  });

  it('is the objective with its stage', () => {
    expect(goalLine(guidance('Cache lookups'), undefined)).toEqual({ stage: 'implement', text: 'Cache lookups' });
  });

  it('falls back to the current milestone, then to nothing', () => {
    const plan = facts([milestone('a', 'in_progress')], { currentMilestoneId: 'a' });
    expect(goalLine(guidance('   '), plan)).toEqual({ text: 'Title a' });
    expect(goalLine(undefined, plan)).toEqual({ text: 'Title a' });
    expect(goalLine(undefined, facts([]))).toEqual({ text: '' });
    expect(goalLine(undefined, undefined)).toEqual({ text: '' });
  });
});

describe('latestNext', () => {
  it('is the most recent suggestion, whatever order they arrive in', () => {
    const events = [next('old', '2026-10-02T10:00:00.000Z'), next('new', '2026-10-02T11:00:00.000Z'), next('middle', '2026-10-02T10:30:00.000Z')];
    expect(latestNext(events)?.payload.title).toBe('new');
  });

  it('ignores other events and is undefined without a suggestion', () => {
    expect(latestNext([proposal('a', 'reopen', '2026-10-02T10:00:00.000Z')])).toBeUndefined();
    expect(latestNext([])).toBeUndefined();
  });
});

describe('nextAction', () => {
  const plan = [milestone('a', 'done'), milestone('b', 'in_progress'), milestone('c', 'upcoming', { waitingOn: ['b'] }), milestone('d', 'upcoming')];

  it('asks for the answer to a question before anything else, even the AI suggestion', () => {
    const action = nextAction(facts(plan, { openQuestions: [question('Which cache should we use?')] }), next('Add tests', '2026-10-02T10:00:00.000Z') as never);
    expect(action).toEqual({ kind: 'panel', section: 'open', label: 'Answer the question', reason: 'Which cache should we use?' });
  });

  it('shortens a long question', () => {
    const action = nextAction(facts(plan, { openQuestions: [question('x'.repeat(400))] }));
    const reason = action?.kind === 'panel' ? action.reason : '';
    expect(reason).toHaveLength(140);
    expect(reason.endsWith('...')).toBe(true);
    // A question that fits is left alone.
    expect(nextAction(facts(plan, { openQuestions: [question('x'.repeat(140))] }))).toMatchObject({ reason: 'x'.repeat(140) });
  });

  it('offers the AI suggestion next, filling the prompt and pointing at the file when it names one', () => {
    const suggestion = next('Add a test for the cache', '2026-10-02T10:00:00.000Z', { path: 'src/cache.ts', repo: 'api', line: 42 });
    expect(nextAction(facts(plan), suggestion as never)).toEqual({
      kind: 'prompt', source: 'ai', label: 'Add a test for the cache', reason: 'because Add a test for the cache',
      prompt: 'Go ahead: Add a test for the cache', target: { path: 'api/src/cache.ts', line: 42 },
    });
    const plain = nextAction(facts(plan), next('Do it', '2026-10-02T10:00:00.000Z') as never);
    expect(plain && 'target' in plain).toBe(false);
  });

  it('otherwise follows the facts: blocked, failing check, reopened, in progress, then the next ready milestone', () => {
    expect(nextAction(facts([milestone('a', 'blocked', { blockedReason: 'needs a key' })]))).toMatchObject({ kind: 'panel', section: 'milestones', label: 'Unblock "Title a"', reason: 'needs a key' });
    expect(nextAction(facts([milestone('a', 'done')], { verification: { status: 'fail', freshness: 'fresh' } }))).toMatchObject({ kind: 'prompt', source: 'facts', label: 'Look at the failing check' });
    expect(nextAction(facts([milestone('a', 'reopened', { reopen: { at: '2026-10-02T10:00:00.000Z', reason: 'misses a case', by: 'user' } })])))
      .toMatchObject({ label: 'Redo "Title a"', reason: 'Reopened: misses a case', prompt: 'Let\'s redo "Title a": misses a case' });
    expect(nextAction(facts(plan, { currentMilestoneId: 'b' }))).toMatchObject({ label: 'Continue "Title b"', prompt: 'Continue with "Title b".' });
    expect(nextAction(facts([milestone('a', 'done'), milestone('c', 'upcoming', { waitingOn: ['z'] }), milestone('d', 'upcoming')]))).toMatchObject({ label: 'Start "Title d"' });
  });

  it('has nothing to offer when everything is done or nothing can start', () => {
    expect(nextAction(facts([milestone('a', 'done')]))).toBeNull();
    expect(nextAction(facts([]))).toBeNull();
    expect(nextAction(facts([milestone('c', 'upcoming', { waitingOn: ['z'] })]))).toBeNull();
  });

  it('does not ask about a question whose source could not be read', () => {
    expect(nextAction(facts([milestone('a', 'done')], { openQuestions: [question()], unavailable: unavailable('questions') }))).toBeNull();
  });
});

describe('activeProposals', () => {
  const done = milestone('a', 'done', { completedAt: '2026-10-02T09:00:00.000Z' });
  const working = milestone('b', 'in_progress');

  it('keeps a reopen proposal for a finished milestone and a complete proposal for one under way', () => {
    const events = [proposal('a', 'reopen', '2026-10-02T10:00:00.000Z'), proposal('b', 'complete', '2026-10-02T10:00:00.000Z')];
    expect(activeProposals(events, facts([done, working])).map((p) => [p.milestone.id, p.event.payload.proposal])).toEqual([['a', 'reopen'], ['b', 'complete']]);
  });

  it('keeps only the newest proposal for each milestone', () => {
    const events = [proposal('a', 'reopen', '2026-10-02T10:00:00.000Z', 'first'), proposal('a', 'reopen', '2026-10-02T11:00:00.000Z', 'second')];
    const [only, ...rest] = activeProposals(events, facts([done]));
    expect(rest).toEqual([]);
    expect(only!.event.payload.reason).toBe('second');
  });

  it('drops a proposal the milestone has moved past', () => {
    // Reopen proposed, but it was completed again after that.
    expect(activeProposals([proposal('a', 'reopen', '2026-10-02T08:00:00.000Z')], facts([done]))).toEqual([]);
    // A reopen proposal for work that is not finished makes no sense.
    expect(activeProposals([proposal('b', 'reopen', '2026-10-02T10:00:00.000Z')], facts([working]))).toEqual([]);
    // Complete proposed, then the milestone was reopened.
    const reopened = milestone('b', 'reopened', { reopen: { at: '2026-10-02T11:00:00.000Z', reason: 'no', by: 'user' } });
    expect(activeProposals([proposal('b', 'complete', '2026-10-02T10:00:00.000Z')], facts([reopened]))).toEqual([]);
    // A complete proposal for a milestone that is already done is moot.
    expect(activeProposals([proposal('a', 'complete', '2026-10-02T10:00:00.000Z')], facts([done]))).toEqual([]);
  });

  it('drops proposals for milestones that are not in the plan and ones the developer dismissed', () => {
    const gone = proposal('zzz', 'reopen', '2026-10-02T10:00:00.000Z');
    const dismissed = proposal('a', 'reopen', '2026-10-02T10:00:00.000Z');
    expect(activeProposals([gone], facts([done]))).toEqual([]);
    expect(activeProposals([dismissed], facts([done]), new Set([dismissed.id]))).toEqual([]);
  });

  it('treats a time it cannot read as not newer, so the proposal stays visible', () => {
    expect(activeProposals([proposal('a', 'reopen', 'not a time')], facts([done]))).toHaveLength(1);
  });

  it('lists proposals in plan order', () => {
    const events = [proposal('b', 'complete', '2026-10-02T10:00:00.000Z'), proposal('a', 'reopen', '2026-10-02T10:00:00.000Z')];
    expect(activeProposals(events, facts([done, working])).map((p) => p.milestone.id)).toEqual(['a', 'b']);
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');
  it('rounds down to the largest unit', () => {
    expect(formatAge('2026-10-02T11:59:40.000Z', now)).toBe('just now');
    expect(formatAge('2026-10-02T11:55:00.000Z', now)).toBe('5 min ago');
    expect(formatAge('2026-10-02T09:00:00.000Z', now)).toBe('3 h ago');
    expect(formatAge('2026-09-30T12:00:00.000Z', now)).toBe('2 d ago');
  });

  it('is empty for a missing or unreadable time, and just now for a time in the future', () => {
    expect(formatAge(undefined, now)).toBe('');
    expect(formatAge('soon', now)).toBe('');
    expect(formatAge('2026-10-02T13:00:00.000Z', now)).toBe('just now');
  });
});

describe('verificationLine', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');
  const check = (status: ProgressFacts['verification']['status'], freshness: ProgressFacts['verification']['freshness'], extra: Partial<ProgressFacts> = {}) =>
    facts([], { verification: { status, freshness, verifiedAt: '2026-10-02T09:00:00.000Z' }, ...extra });

  it('says how the last check ended and how long ago', () => {
    expect(verificationLine(check('fail', 'fresh'), now)).toEqual({ tone: 'bad', text: 'The last check failed 3 h ago.' });
    expect(verificationLine(check('timeout', 'fresh'), now)).toEqual({ tone: 'bad', text: 'The last check timed out 3 h ago.' });
    expect(verificationLine(check('pass', 'fresh'), now)).toEqual({ tone: 'ok', text: 'The last check passed 3 h ago.' });
  });

  it('says so when the code has changed since, and does not raise an alarm for an old failure', () => {
    expect(verificationLine(check('pass', 'stale'), now)).toEqual({ tone: 'note', text: 'The last check passed 3 h ago; the code has changed since.' });
    expect(verificationLine(check('fail', 'stale'), now)).toEqual({ tone: 'note', text: 'The last check failed 3 h ago; the code has changed since.' });
  });

  it('is null when no check ran, it was skipped, or the source could not be read', () => {
    expect(verificationLine(check('never', 'unknown'), now)).toBeNull();
    expect(verificationLine(check('skipped', 'unknown'), now)).toBeNull();
    expect(verificationLine(check('fail', 'fresh', { unavailable: unavailable('verification') }), now)).toBeNull();
  });
});
