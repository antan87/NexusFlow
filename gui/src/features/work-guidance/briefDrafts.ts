/**
 * Recoverable drafts for the work brief: unsaved assignment, milestone, delivery-notes and source-document
 * edits are kept per workspace, so leaving the workspace or reloading the app does not lose them.
 * File: gui/src/features/work-guidance/briefDrafts.ts
 *
 * A draft remembers the saved version it was started from, so loading the brief again can tell what
 * the user changed from what someone else saved since. Edits that do not overlap are combined; edits
 * to a field that was also saved differently are reported as a conflict and never applied silently.
 * Storage failures degrade to in-memory drafts (see `writeDraft`).
 */
import type { LifecycleStep, WorkDocument, WorkGuidance } from '../../types.js';

export type BriefKind = 'assignment' | 'milestones' | 'notes' | 'document';
export type AssignmentDraft = Pick<WorkGuidance, 'workType' | 'size' | 'assignment'>;
/** The Add source document form. Pasted source text may be sensitive, so this kind is kept per window, not per device. */
export interface DocumentFormDraft {
  document: Pick<WorkDocument, 'title' | 'role' | 'status' | 'scope' | 'summary'>;
  sourceType: 'text' | 'link';
  content: string;
  url: string;
}
interface DraftValues { assignment: AssignmentDraft; milestones: LifecycleStep[]; notes: string; document: DocumentFormDraft }
/** What a draft was started from. Delivery notes can be large, so they remember the saved revision rather than the saved text. */
interface DraftBases { assignment: AssignmentDraft; milestones: LifecycleStep[]; notes: string; document: DocumentFormDraft }
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredDraft<T, B = T> {
  /** The saved version this draft was started from. */
  base: B;
  value: T;
  savedAt: number;
}
export type DraftDecision<T, B = T> =
  | { kind: 'none' }
  /** The draft, combined with what was saved since, ready to show as unsaved edits. */
  | { kind: 'restore'; value: T }
  | { kind: 'conflict'; draft: StoredDraft<T, B> };
export interface DraftDifference { label: string; draft: string; saved: string }

const KEY_PREFIX = 'contextspace.brief-draft';
const FORMAT = 1;
/** Drafts nobody came back to are dropped rather than kept forever. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const WORK_TYPES = ['bug', 'feature', 'performance', 'refactor', 'rewrite'];
const SIZES = ['small', 'standard', 'epic'];
const STAGES = ['investigate', 'design', 'implement', 'verify', 'review', 'release'];
const DOCUMENT_ROLES = ['requirements', 'design', 'evidence', 'reference'];
const DOCUMENT_STATUSES = ['draft', 'approved', 'superseded'];
const MAX_STEPS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isAssignment = (value: unknown): value is AssignmentDraft => {
  if (!isRecord(value) || !isRecord(value.assignment)) return false;
  const { assignment } = value;
  return WORK_TYPES.includes(value.workType as string) && SIZES.includes(value.size as string) && STAGES.includes(assignment.stage as string)
    && isString(assignment.objective) && isString(assignment.expectedOutput) && isString(assignment.stopCondition)
    && (assignment.milestoneId === undefined || isString(assignment.milestoneId));
};
const isSteps = (value: unknown): value is LifecycleStep[] => Array.isArray(value) && value.length <= MAX_STEPS
  && value.every((step) => isRecord(step) && isString(step.id) && isString(step.title) && isString(step.status));
const isDocumentForm = (value: unknown): value is DocumentFormDraft => {
  if (!isRecord(value) || !isRecord(value.document)) return false;
  const { document } = value;
  return isString(document.title) && isString(document.summary) && DOCUMENT_ROLES.includes(document.role as string) && DOCUMENT_STATUSES.includes(document.status as string)
    && isRecord(document.scope) && (document.scope.milestoneId === undefined || isString(document.scope.milestoneId)) && (document.scope.project === undefined || typeof document.scope.project === 'boolean')
    && (value.sourceType === 'text' || value.sourceType === 'link') && isString(value.content) && isString(value.url);
};
const validators: { [K in BriefKind]: { base: (value: unknown) => value is DraftBases[K]; value: (value: unknown) => value is DraftValues[K] } } = {
  assignment: { base: isAssignment, value: isAssignment },
  milestones: { base: isSteps, value: isSteps },
  notes: { base: isString, value: isString },
  document: { base: isDocumentForm, value: isDocumentForm },
};

function browserStorage(kind: BriefKind): DraftStorage | null {
  // Reading the storage object itself throws when site data is blocked.
  try {
    if (kind === 'document') return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch { return null; }
}
const keyFor = (kind: BriefKind, workspaceId: string) => `${KEY_PREFIX}.${kind}.${encodeURIComponent(workspaceId)}`;

export function readDraft<K extends BriefKind>(kind: K, workspaceId: string, storage: DraftStorage | null = browserStorage(kind), now = Date.now()): StoredDraft<DraftValues[K], DraftBases[K]> | null {
  if (!storage) return null;
  const key = keyFor(kind, workspaceId);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const valid = validators[kind];
    if (isRecord(parsed) && parsed.format === FORMAT && valid.base(parsed.base) && valid.value(parsed.value)
      && typeof parsed.savedAt === 'number' && now - parsed.savedAt <= DRAFT_MAX_AGE_MS) {
      return { base: parsed.base, value: parsed.value, savedAt: parsed.savedAt } as StoredDraft<DraftValues[K], DraftBases[K]>;
    }
    storage.removeItem(key); // Unreadable, outdated, or expired: nothing worth recovering.
  } catch { /* A broken store must not break the brief. */ }
  return null;
}

/** Returns false when the draft could not be kept (blocked or full storage). */
export function writeDraft<K extends BriefKind>(kind: K, workspaceId: string, base: DraftBases[K], value: DraftValues[K], storage: DraftStorage | null = browserStorage(kind), now = Date.now()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(keyFor(kind, workspaceId), JSON.stringify({ format: FORMAT, base, value, savedAt: now }));
    return true;
  } catch { return false; }
}

export function clearDraft(kind: BriefKind, workspaceId: string, storage: DraftStorage | null = browserStorage(kind)): void {
  try { storage?.removeItem(keyFor(kind, workspaceId)); } catch { /* Nothing to clear. */ }
}

export const pickAssignment = ({ workType, size, assignment }: AssignmentDraft): AssignmentDraft => ({ workType, size, assignment });

interface AssignmentField { label: string; read: (value: AssignmentDraft) => string; copy: (to: AssignmentDraft, from: AssignmentDraft) => void }
const ASSIGNMENT_FIELDS: AssignmentField[] = [
  { label: 'Work type', read: (value) => value.workType, copy: (to, from) => { to.workType = from.workType; } },
  { label: 'Size', read: (value) => value.size, copy: (to, from) => { to.size = from.size; } },
  { label: 'Current stage', read: (value) => value.assignment.stage, copy: (to, from) => { to.assignment.stage = from.assignment.stage; } },
  {
    label: 'Assignment scope', read: (value) => value.assignment.milestoneId ?? '',
    copy: (to, from) => { if (from.assignment.milestoneId === undefined) delete to.assignment.milestoneId; else to.assignment.milestoneId = from.assignment.milestoneId; },
  },
  { label: 'Current objective', read: (value) => value.assignment.objective, copy: (to, from) => { to.assignment.objective = from.assignment.objective; } },
  { label: 'Expected output', read: (value) => value.assignment.expectedOutput, copy: (to, from) => { to.assignment.expectedOutput = from.assignment.expectedOutput; } },
  { label: 'Stop when', read: (value) => value.assignment.stopCondition, copy: (to, from) => { to.assignment.stopCondition = from.assignment.stopCondition; } },
];

export function assignmentChanges(draft: AssignmentDraft, saved: AssignmentDraft): DraftDifference[] {
  return ASSIGNMENT_FIELDS.map((field) => ({ label: field.label, draft: field.read(draft), saved: field.read(saved) })).filter((change) => change.draft !== change.saved);
}
export const sameAssignment = (a: AssignmentDraft, b: AssignmentDraft) => assignmentChanges(a, b).length === 0;

const touchedByUser = (draft: StoredDraft<AssignmentDraft>, field: AssignmentField) => field.read(draft.value) !== field.read(draft.base);

/** The fields the user edited that were also saved differently since: the only real conflicts. */
export function assignmentConflicts(draft: StoredDraft<AssignmentDraft>, saved: AssignmentDraft): DraftDifference[] {
  return ASSIGNMENT_FIELDS
    .filter((field) => touchedByUser(draft, field) && field.read(draft.base) !== field.read(saved) && field.read(draft.value) !== field.read(saved))
    .map((field) => ({ label: field.label, draft: field.read(draft.value), saved: field.read(saved) }));
}

/** The saved version with the user's own edits on top; fields the user did not touch follow what was saved. */
export function mergeAssignmentDraft(draft: StoredDraft<AssignmentDraft>, saved: AssignmentDraft): AssignmentDraft {
  const merged: AssignmentDraft = { workType: saved.workType, size: saved.size, assignment: { ...saved.assignment } };
  for (const field of ASSIGNMENT_FIELDS) if (touchedByUser(draft, field)) field.copy(merged, draft.value);
  return merged;
}

/** Decide what a stored assignment draft means for the version that was just loaded. */
export function reconcileAssignment(stored: StoredDraft<AssignmentDraft> | null, saved: AssignmentDraft): DraftDecision<AssignmentDraft> {
  if (!stored || sameAssignment(stored.value, saved)) return { kind: 'none' };
  if (assignmentConflicts(stored, saved).length) return { kind: 'conflict', draft: stored };
  const merged = mergeAssignmentDraft(stored, saved);
  return sameAssignment(merged, saved) ? { kind: 'none' } : { kind: 'restore', value: merged };
}

/** Progress is recorded by the workflow, and a plan save ignores it, so it is not something a draft can edit or conflict on. */
const PROGRESS_FIELDS = new Set(['status', 'lastVerificationSha', 'lastVerificationStatus', 'completedAt']);

/** Key order, empty optional fields and workflow progress carry no meaning for a plan edit. */
function canonical(steps: LifecycleStep[]): string {
  const meaningful = (value: unknown): boolean => value !== undefined && value !== null && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0);
  return JSON.stringify(steps, (_key, value: unknown) => isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([key, entry]) => !PROGRESS_FIELDS.has(key) && meaningful(entry)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value);
}
export const sameSteps = (a: LifecycleStep[], b: LifecycleStep[]) => canonical(a) === canonical(b);

/** Keep a draft's definitions but show the milestones' current progress, which only the workflow changes. */
export function withSavedProgress(draft: LifecycleStep[], saved: LifecycleStep[]): LifecycleStep[] {
  const savedById = new Map(saved.map((step) => [step.id, step]));
  return draft.map((step) => {
    const current = savedById.get(step.id);
    if (!current) return step;
    const merged: LifecycleStep = { ...step, status: current.status };
    for (const key of ['lastVerificationSha', 'lastVerificationStatus', 'completedAt'] as const) {
      if (current[key] === undefined) delete merged[key]; else merged[key] = current[key];
    }
    return merged;
  });
}

/** Milestone edits are restored when nobody saved a different plan meanwhile; otherwise the user chooses between the two plans. */
export function reconcileMilestones(stored: StoredDraft<LifecycleStep[]> | null, saved: LifecycleStep[]): DraftDecision<LifecycleStep[]> {
  if (!stored || sameSteps(stored.value, saved)) return { kind: 'none' };
  return sameSteps(stored.base, saved) ? { kind: 'restore', value: withSavedProgress(stored.value, saved) } : { kind: 'conflict', draft: stored };
}

const STEP_DETAILS: Array<[keyof LifecycleStep, string]> = [
  ['branch', 'branch'], ['repo', 'repository'], ['workItem', 'work item'], ['unblockCondition', 'unblock condition'], ['owner', 'owner'], ['verificationCommand', 'verification command'],
];
function describeStep(step: LifecycleStep): string {
  const details = STEP_DETAILS.flatMap(([key, label]) => step[key] ? [`${label}: ${String(step[key])}`] : []);
  if (step.dependsOn?.length) details.push(`depends on: ${step.dependsOn.join(', ')}`);
  if (step.requiresVerification) details.push('verified before completing');
  if (step.verificationTimeoutSeconds) details.push(`time limit: ${Math.round(step.verificationTimeoutSeconds / 60)} min`);
  return [`${step.title.trim() || 'Untitled milestone'}${step.description?.trim() ? ` — ${step.description.trim()}` : ''}`, ...details].join(' · ');
}

/** What choosing the draft would change in the saved plan. */
export function stepChanges(draft: LifecycleStep[], saved: LifecycleStep[]): DraftDifference[] {
  const savedById = new Map(saved.map((step) => [step.id, step]));
  const draftIds = new Set(draft.map((step) => step.id));
  const changes: DraftDifference[] = [];
  for (const step of draft) {
    const counterpart = savedById.get(step.id);
    if (!counterpart) changes.push({ label: step.title.trim() || 'Untitled milestone', draft: describeStep(step), saved: 'Not in the saved plan' });
    else if (!sameSteps([step], [counterpart])) changes.push({ label: counterpart.title.trim() || 'Untitled milestone', draft: describeStep(step), saved: describeStep(counterpart) });
  }
  for (const step of saved) {
    if (!draftIds.has(step.id)) changes.push({ label: step.title.trim() || 'Untitled milestone', draft: 'Not in your draft', saved: describeStep(step) });
  }
  return changes;
}

/** Delivery notes are one document: the draft is restored when the saved revision is the one it started from, and otherwise the user chooses. */
export function reconcileNotes(stored: StoredDraft<string> | null, saved: { content: string; revision: string }): DraftDecision<string> {
  if (!stored || stored.value === saved.content) return { kind: 'none' };
  return stored.base === saved.revision ? { kind: 'restore', value: stored.value } : { kind: 'conflict', draft: stored };
}

export const emptyDocumentForm = (): DocumentFormDraft => ({
  document: { title: '', role: 'requirements', status: 'draft', scope: {}, summary: '' }, sourceType: 'text', content: '', url: '',
});
/** `undefined` scope keys carry no meaning, so JSON equality is enough. */
export const sameDocumentForm = (a: DocumentFormDraft, b: DocumentFormDraft) => JSON.stringify(a) === JSON.stringify(b);

/** The Add source document form has no saved version to clash with: any input is restored. */
export function reconcileDocumentForm(stored: StoredDraft<DocumentFormDraft> | null): DraftDecision<DocumentFormDraft> {
  return !stored || sameDocumentForm(stored.value, emptyDocumentForm()) ? { kind: 'none' } : { kind: 'restore', value: stored.value };
}
