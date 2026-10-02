import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleStep } from '../../types.js';
import {
  DRAFT_MAX_AGE_MS, assignmentChanges, assignmentConflicts, clearDraft, emptyDocumentForm, mergeAssignmentDraft, pickAssignment, readDraft, reconcileAssignment,
  reconcileDocumentForm, reconcileMilestones, reconcileNotes, sameSteps, stepChanges, withSavedProgress, writeDraft,
  type AssignmentDraft, type DocumentFormDraft, type DraftStorage, type StoredDraft,
} from './briefDrafts.js';

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}
const saved = (): AssignmentDraft => ({ workType: 'feature', size: 'epic', assignment: { stage: 'implement', objective: 'Fix links', expectedOutput: '', stopCondition: '' } });
const edited = (): AssignmentDraft => ({ ...saved(), assignment: { ...saved().assignment, expectedOutput: 'Merged PRs' } });
const step = (id: string, patch: Partial<LifecycleStep> = {}): LifecycleStep => ({ id, title: id, status: 'pending', ...patch });

describe('brief draft storage', () => {
  it('keeps a draft per workspace and kind', () => {
    const storage = memoryStorage();
    expect(writeDraft('assignment', 'demo', saved(), edited(), storage, 1000)).toBe(true);
    expect(readDraft('assignment', 'demo', storage, 2000)).toEqual({ base: saved(), value: edited(), savedAt: 1000 });
    expect(readDraft('assignment', 'other', storage, 2000)).toBeNull();
    expect(readDraft('milestones', 'demo', storage, 2000)).toBeNull();
    clearDraft('assignment', 'demo', storage);
    expect(readDraft('assignment', 'demo', storage, 2000)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('keeps workspace ids that need escaping apart', () => {
    const storage = memoryStorage();
    writeDraft('milestones', 'feat/a b', [], [step('one')], storage);
    expect(readDraft('milestones', 'feat/a b', storage)?.value).toEqual([step('one')]);
    expect(readDraft('milestones', 'feat/a', storage)).toBeNull();
  });

  it('drops drafts nobody came back to', () => {
    const storage = memoryStorage();
    writeDraft('assignment', 'demo', saved(), edited(), storage, 0);
    expect(readDraft('assignment', 'demo', storage, DRAFT_MAX_AGE_MS)).not.toBeNull();
    expect(readDraft('assignment', 'demo', storage, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it.each([
    ['not JSON', '{oops'],
    ['not an object', '[]'],
    ['another format', JSON.stringify({ format: 2, base: saved(), value: edited(), savedAt: 1 })],
    ['an unknown work type', JSON.stringify({ format: 1, base: saved(), value: { ...edited(), workType: 'chore' }, savedAt: 1 })],
    ['a missing field', JSON.stringify({ format: 1, base: saved(), value: { workType: 'bug', size: 'small' }, savedAt: 1 })],
    ['a missing timestamp', JSON.stringify({ format: 1, base: saved(), value: edited() })],
  ])('ignores and removes a stored draft that is %s', (_name, raw) => {
    const storage = memoryStorage();
    storage.setItem('contextspace.brief-draft.assignment.demo', raw);
    expect(readDraft('assignment', 'demo', storage, 2)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('rejects malformed milestone drafts', () => {
    const storage = memoryStorage();
    storage.setItem('contextspace.brief-draft.milestones.demo', JSON.stringify({ format: 1, base: [], value: [{ id: 'a' }], savedAt: 1 }));
    expect(readDraft('milestones', 'demo', storage, 2)).toBeNull();
  });

  it('reports a draft it could not keep and never throws', () => {
    const full: DraftStorage = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: () => undefined };
    expect(writeDraft('assignment', 'demo', saved(), edited(), full)).toBe(false);
    expect(writeDraft('assignment', 'demo', saved(), edited(), null)).toBe(false);
    const broken: DraftStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readDraft('assignment', 'demo', broken)).toBeNull();
    expect(readDraft('assignment', 'demo', null)).toBeNull();
    expect(() => clearDraft('assignment', 'demo', broken)).not.toThrow();
    expect(() => clearDraft('assignment', 'demo', null)).not.toThrow();
  });
});

describe('reconciling a stored assignment draft with the saved version', () => {
  const withAssignment = (patch: Partial<AssignmentDraft['assignment']>, rest: Partial<AssignmentDraft> = {}): AssignmentDraft => ({ ...saved(), ...rest, assignment: { ...saved().assignment, ...patch } });
  const stored: StoredDraft<AssignmentDraft> = { base: saved(), value: edited(), savedAt: 1 };

  it('has nothing to do without a draft, or once the draft was saved', () => {
    expect(reconcileAssignment(null, saved())).toEqual({ kind: 'none' });
    expect(reconcileAssignment(stored, edited())).toEqual({ kind: 'none' });
  });

  it('restores a draft started from the version that is still saved', () => {
    expect(reconcileAssignment(stored, saved())).toEqual({ kind: 'restore', value: edited() });
  });

  it('combines edits with a saved change to different fields instead of calling it a conflict', () => {
    const verify = withAssignment({ stage: 'verify' });
    const decision = reconcileAssignment(stored, verify);
    expect(decision).toEqual({ kind: 'restore', value: withAssignment({ stage: 'verify', expectedOutput: 'Merged PRs' }) });
  });

  it('is not a conflict when only fields outside the draft changed, such as a source document', () => {
    expect(reconcileAssignment(stored, { ...saved() }).kind).toBe('restore');
  });

  it('drops a draft whose edits were already saved by someone else', () => {
    expect(reconcileAssignment(stored, edited())).toEqual({ kind: 'none' });
    const sameChange = withAssignment({ expectedOutput: 'Merged PRs', stage: 'verify' });
    expect(reconcileAssignment(stored, sameChange)).toEqual({ kind: 'none' });
  });

  it('reports a conflict, and applies nothing, when the same field was saved differently', () => {
    const theirs = withAssignment({ expectedOutput: 'Their output', stage: 'verify' });
    expect(reconcileAssignment(stored, theirs)).toEqual({ kind: 'conflict', draft: stored });
    expect(assignmentConflicts(stored, theirs)).toEqual([{ label: 'Expected output', draft: 'Merged PRs', saved: 'Their output' }]);
  });

  it('keeps only what the user changed when they choose their edits', () => {
    const theirs = withAssignment({ expectedOutput: 'Their output', stage: 'verify' }, { size: 'small' });
    // The user changed only the expected output: stage and size follow the saved version.
    expect(mergeAssignmentDraft(stored, theirs)).toEqual(withAssignment({ expectedOutput: 'Merged PRs', stage: 'verify' }, { size: 'small' }));
  });

  it('merges a cleared scope as no scope', () => {
    const scoped = withAssignment({ milestoneId: 'm1' });
    const cleared: StoredDraft<AssignmentDraft> = { base: scoped, value: withAssignment({ milestoneId: undefined }), savedAt: 1 };
    const merged = mergeAssignmentDraft(cleared, scoped);
    expect(merged.assignment).not.toHaveProperty('milestoneId');
    expect(scoped.assignment.milestoneId).toBe('m1');
  });
});

describe('reconciling a stored milestone draft with the saved plan', () => {
  const base = [step('a'), step('b')];
  const draft: StoredDraft<ReturnType<typeof step>[]> = { base, value: [step('a'), step('b', { title: 'Renamed' }), step('c')], savedAt: 1 };

  it('restores a draft started from the plan that is still saved', () => {
    expect(reconcileMilestones(draft, base)).toEqual({ kind: 'restore', value: draft.value });
    expect(reconcileMilestones(null, base)).toEqual({ kind: 'none' });
    expect(reconcileMilestones(draft, draft.value)).toEqual({ kind: 'none' });
  });

  it('is not a conflict when only workflow progress changed, and shows the current progress', () => {
    const progressed = [step('a', { status: 'completed', completedAt: 'then', lastVerificationSha: 'abc' }), step('b', { status: 'in_progress' })];
    const decision = reconcileMilestones(draft, progressed);
    expect(decision.kind).toBe('restore');
    if (decision.kind !== 'restore') return;
    expect(decision.value.map((item) => [item.id, item.title, item.status])).toEqual([['a', 'a', 'completed'], ['b', 'Renamed', 'in_progress'], ['c', 'c', 'pending']]);
    expect(decision.value[0]).toMatchObject({ completedAt: 'then', lastVerificationSha: 'abc' });
  });

  it('reports a conflict when the plan itself was saved differently', () => {
    expect(reconcileMilestones(draft, [step('a'), step('b'), step('x')]).kind).toBe('conflict');
    expect(reconcileMilestones(draft, [step('a', { description: 'New outcome' }), step('b')]).kind).toBe('conflict');
  });

  it('clears progress the saved plan does not have', () => {
    const shown = withSavedProgress([step('a', { status: 'completed', completedAt: 'stale' })], [step('a', { status: 'pending' })]);
    expect(shown[0]).toEqual({ id: 'a', title: 'a', status: 'pending' });
  });
});

describe('describing differences', () => {
  it('lists only the assignment fields that differ', () => {
    expect(assignmentChanges(saved(), saved())).toEqual([]);
    expect(assignmentChanges({ ...edited(), size: 'small' }, saved())).toEqual([
      { label: 'Size', draft: 'small', saved: 'epic' },
      { label: 'Expected output', draft: 'Merged PRs', saved: '' },
    ]);
    const scoped: AssignmentDraft = { ...saved(), assignment: { ...saved().assignment, milestoneId: 'm1' } };
    expect(assignmentChanges(scoped, saved())).toEqual([{ label: 'Assignment scope', draft: 'm1', saved: '' }]);
  });

  it('picks the assignment fields out of a whole brief', () => {
    const brief = { ...saved(), version: 1 as const, revision: 4, documents: [] };
    expect(pickAssignment(brief)).toEqual(saved());
  });

  it('ignores key order and empty optional milestone fields', () => {
    expect(sameSteps([{ status: 'pending', title: 'a', id: 'a' }], [step('a', { description: '', branch: undefined, dependsOn: [], requiresVerification: false })])).toBe(true);
    expect(sameSteps([step('a')], [step('a', { description: 'Outcome' })])).toBe(false);
    expect(sameSteps([step('a'), step('b')], [step('b'), step('a')])).toBe(false);
  });

  it('names added, removed and edited milestones', () => {
    const changes = stepChanges(
      [step('keep'), step('edit', { title: 'Edited title' }), step('new', { description: 'Fresh' })],
      [step('keep'), step('edit'), step('gone', { status: 'in_progress' })],
    );
    expect(changes).toEqual([
      { label: 'edit', draft: 'Edited title', saved: 'edit' },
      { label: 'new', draft: 'new — Fresh', saved: 'Not in the saved plan' },
      { label: 'gone', draft: 'Not in your draft', saved: 'gone' },
    ]);
    expect(stepChanges([step('a')], [step('a')])).toEqual([]);
  });
});

describe('delivery notes drafts', () => {
  const savedNotes = { content: '# Saved', revision: 'r1' };
  const stored: StoredDraft<string> = { base: 'r1', value: '# Mine', savedAt: 1 };

  it('stores the revision a draft started from, not the saved text', () => {
    const storage = memoryStorage();
    expect(writeDraft('notes', 'demo', 'r1', '# Mine', storage, 5)).toBe(true);
    expect(readDraft('notes', 'demo', storage, 6)).toEqual({ base: 'r1', value: '# Mine', savedAt: 5 });
    expect(storage.data.get('contextspace.brief-draft.notes.demo')).not.toContain('# Saved');
  });

  it('restores notes started from the saved revision, and chooses when the revision moved on', () => {
    expect(reconcileNotes(null, savedNotes)).toEqual({ kind: 'none' });
    expect(reconcileNotes(stored, { content: '# Mine', revision: 'r2' })).toEqual({ kind: 'none' });
    expect(reconcileNotes(stored, savedNotes)).toEqual({ kind: 'restore', value: '# Mine' });
    expect(reconcileNotes(stored, { content: '# Theirs', revision: 'r2' })).toEqual({ kind: 'conflict', draft: stored });
  });

  it('keeps an empty draft: clearing the notes is an edit', () => {
    expect(reconcileNotes({ base: 'r1', value: '', savedAt: 1 }, savedNotes)).toEqual({ kind: 'restore', value: '' });
  });

  it('ignores a notes draft that is not text', () => {
    const storage = memoryStorage({ 'contextspace.brief-draft.notes.demo': JSON.stringify({ format: 1, base: 1, value: { text: 'x' }, savedAt: 1 }) });
    expect(readDraft('notes', 'demo', storage, 2)).toBeNull();
  });
});

describe('source document form drafts', () => {
  const form = (patch: Partial<DocumentFormDraft> = {}): DocumentFormDraft => ({ ...emptyDocumentForm(), ...patch });
  const stored = (value: DocumentFormDraft): StoredDraft<DocumentFormDraft> => ({ base: emptyDocumentForm(), value, savedAt: 1 });

  it('restores any input, and nothing for an untouched form', () => {
    expect(reconcileDocumentForm(null)).toEqual({ kind: 'none' });
    expect(reconcileDocumentForm(stored(emptyDocumentForm()))).toEqual({ kind: 'none' });
    const typed = form({ content: '# Pasted' });
    expect(reconcileDocumentForm(stored(typed))).toEqual({ kind: 'restore', value: typed });
  });

  it('treats a scope with no milestone as the empty scope', () => {
    expect(reconcileDocumentForm(stored(form({ document: { ...emptyDocumentForm().document, scope: { milestoneId: undefined } } }))).kind).toBe('none');
  });

  it('round-trips the form, and rejects a malformed one', () => {
    const storage = memoryStorage();
    const typed = form({ sourceType: 'link', url: 'https://example.com/spec', document: { ...emptyDocumentForm().document, title: 'Spec', scope: { project: true } } });
    writeDraft('document', 'demo', emptyDocumentForm(), typed, storage, 1);
    expect(readDraft('document', 'demo', storage, 2)?.value).toEqual(typed);
    storage.setItem('contextspace.brief-draft.document.demo', JSON.stringify({ format: 1, base: emptyDocumentForm(), value: { ...typed, sourceType: 'file' }, savedAt: 1 }));
    expect(readDraft('document', 'demo', storage, 2)).toBeNull();
  });
});

describe('where each kind of draft is kept', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps pasted source text for this window only, and everything else on the device', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    writeDraft('document', 'demo', emptyDocumentForm(), { ...emptyDocumentForm(), content: 'secret' });
    writeDraft('notes', 'demo', 'r1', '# Mine');
    writeDraft('assignment', 'demo', saved(), edited());
    expect([...session.data.keys()]).toEqual(['contextspace.brief-draft.document.demo']);
    expect([...local.data.keys()].sort()).toEqual(['contextspace.brief-draft.assignment.demo', 'contextspace.brief-draft.notes.demo']);
    expect(readDraft('document', 'demo')?.value.content).toBe('secret');
    clearDraft('document', 'demo');
    expect(session.data.size).toBe(0);
  });

  it('degrades to no storage when the browser blocks it', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    try {
      expect(writeDraft('assignment', 'demo', saved(), edited())).toBe(false);
      expect(writeDraft('document', 'demo', emptyDocumentForm(), emptyDocumentForm())).toBe(false);
      expect(readDraft('document', 'demo')).toBeNull();
    } finally { Reflect.deleteProperty(globalThis, 'sessionStorage'); }
  });
});
