import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PlanningNotesPanel } from './PlanningNotesPanel.js';
import { DraftConflictNotice, DraftStateLabel, type DraftState } from './BriefDraftNotices.js';
import {
  assignmentConflicts, clearDraft, emptyDocumentForm, mergeAssignmentDraft, pickAssignment, readDraft, reconcileAssignment, reconcileDocumentForm, reconcileMilestones,
  sameAssignment, sameDocumentForm, sameSteps, stepChanges, withSavedProgress, writeDraft, type AssignmentDraft, type BriefKind, type DocumentFormDraft, type StoredDraft,
} from './briefDrafts.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { apiFetch } from '../../lib/api/client.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import type { LifecycleStep, WorkDocument, WorkGuidance, WorkspaceLifecycle } from '../../types.js';

type WorkContext = {
  guidance: WorkGuidance;
  projectId?: string;
  sharedDocuments?: Array<WorkDocument & { workspaceId: string }>;
  lifecycle: WorkspaceLifecycle | null;
  assignment: string;
  contextRefreshed?: boolean;
  contextRefreshError?: string;
};
type DocumentDraft = Pick<WorkDocument, 'title' | 'role' | 'status' | 'scope' | 'summary'>;
/** Kept drafts that disagree with the version saved since: shown for a choice, never applied silently. */
type DraftConflicts = { assignment?: StoredDraft<AssignmentDraft>; milestones?: StoredDraft<LifecycleStep[]> };
type LiveDrafts = DraftConflicts & { document?: StoredDraft<DocumentFormDraft> };
type KeptByThisPanel = 'assignment' | 'milestones' | 'document';
const emptyDocument = (): DocumentDraft => ({ title: '', role: 'requirements', status: 'draft', scope: {}, summary: '' });
const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm';
const stages = ['investigate', 'design', 'implement', 'verify', 'review', 'release'] as const;

export function WorkspaceWorkPanel({ workspaceId, onPlanChanged, readOnly = false }: { workspaceId: string; onPlanChanged: () => void; /** Archived: show the record, change nothing. */ readOnly?: boolean }) {
  const [context, setContext] = useState<WorkContext | null>(null);
  const [draft, setDraft] = useState<WorkGuidance | null>(null);
  const [steps, setSteps] = useState<LifecycleStep[]>([]);
  const [panel, setPanel] = useState<'assignment' | 'documents' | 'milestones' | 'notes'>('assignment');
  const [notesOpened, setNotesOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [document, setDocument] = useState<DocumentDraft>(emptyDocument);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<'text' | 'link'>('text');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<{ title: string; content?: string; location: string } | null>(null);
  const [conflicts, setConflicts] = useState<DraftConflicts>({});
  const [notKept, setNotKept] = useState<Record<KeptByThisPanel, boolean>>({ assignment: false, milestones: false, document: false });
  const [saving, setSaving] = useState<BriefKind | null>(null);
  const [notesState, setNotesState] = useState<DraftState>('saved');
  // The latest unsaved edits, so a reload still finds them when this device cannot store drafts.
  const live = useRef<LiveDrafts>({});
  const base = `/api/workspace/${encodeURIComponent(workspaceId)}`;
  const queryClient = useQueryClient();
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await apiFetch<WorkContext>(`${base}/work`);
      let nextDraft = result.guidance;
      let nextSteps = result.lifecycle?.steps ?? [];
      const found: DraftConflicts = {};
      const kept: string[] = [];
      let nextForm: DocumentFormDraft | null = null;
      if (!readOnly) {
        const assignment = reconcileAssignment(live.current.assignment ?? readDraft('assignment', workspaceId), pickAssignment(result.guidance));
        if (assignment.kind === 'restore') { nextDraft = { ...result.guidance, ...assignment.value }; kept.push('assignment'); }
        else if (assignment.kind === 'conflict') found.assignment = assignment.draft;
        else clearDraft('assignment', workspaceId);
        if (result.lifecycle) {
          const milestones = reconcileMilestones(live.current.milestones ?? readDraft('milestones', workspaceId), result.lifecycle.steps);
          if (milestones.kind === 'restore') { nextSteps = milestones.value; kept.push('milestone'); }
          else if (milestones.kind === 'conflict') found.milestones = milestones.draft;
          else clearDraft('milestones', workspaceId);
        }
        const form = reconcileDocumentForm(live.current.document ?? readDraft('document', workspaceId));
        if (form.kind === 'restore') { nextForm = form.value; kept.push('source document'); }
        else clearDraft('document', workspaceId);
        // Delivery notes load in their own panel: open it so a kept draft is found, and flagged on its tab.
        if (readDraft('notes', workspaceId)) setNotesOpened(true);
      }
      live.current = { ...found }; // A copy: the effects below write to it, and `found` becomes state.
      setContext(result); setDraft(nextDraft); setSteps(nextSteps); setConflicts(found);
      if (nextForm) { setDocument(nextForm.document); setSourceType(nextForm.sourceType); setContent(nextForm.content); setUrl(nextForm.url); setEditingDocumentId(null); }
      if (kept.length) setMessage(`Unsaved ${kept.join(' and ')} edits kept. Save them, or discard them.`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load work brief.'); }
  }, [base, workspaceId, readOnly]);
  useEffect(() => { void load(); }, [load]);

  // Keep unsaved edits on this device as they are made, so leaving the workspace or reloading does not lose them.
  // A pending conflict owns the stored draft until the user chooses.
  useEffect(() => {
    if (readOnly || !context || !draft || conflicts.assignment) return;
    const saved = pickAssignment(context.guidance);
    const mine = pickAssignment(draft);
    if (sameAssignment(mine, saved)) {
      live.current.assignment = undefined; clearDraft('assignment', workspaceId);
      setNotKept((current) => current.assignment ? { ...current, assignment: false } : current);
      return;
    }
    live.current.assignment = { base: saved, value: mine, savedAt: Date.now() };
    const stored = writeDraft('assignment', workspaceId, saved, mine);
    setNotKept((current) => current.assignment === !stored ? current : { ...current, assignment: !stored });
  }, [readOnly, context, draft, conflicts.assignment, workspaceId]);
  useEffect(() => {
    if (readOnly || !context?.lifecycle || conflicts.milestones) return;
    const saved = context.lifecycle.steps;
    if (sameSteps(steps, saved)) {
      live.current.milestones = undefined; clearDraft('milestones', workspaceId);
      setNotKept((current) => current.milestones ? { ...current, milestones: false } : current);
      return;
    }
    live.current.milestones = { base: saved, value: steps, savedAt: Date.now() };
    const stored = writeDraft('milestones', workspaceId, saved, steps);
    setNotKept((current) => current.milestones === !stored ? current : { ...current, milestones: !stored });
  }, [readOnly, context, steps, conflicts.milestones, workspaceId]);
  // The Add source document form has no saved version to clash with. Pasted source text may be sensitive, so it is kept per window only.
  useEffect(() => {
    if (readOnly || !context) return;
    const form: DocumentFormDraft = { document, sourceType, content, url };
    if (editingDocumentId || sameDocumentForm(form, emptyDocumentForm())) {
      live.current.document = undefined; clearDraft('document', workspaceId);
      setNotKept((current) => current.document ? { ...current, document: false } : current);
      return;
    }
    live.current.document = { base: emptyDocumentForm(), value: form, savedAt: Date.now() };
    const stored = writeDraft('document', workspaceId, emptyDocumentForm(), form);
    setNotKept((current) => current.document === !stored ? current : { ...current, document: !stored });
  }, [readOnly, context, document, sourceType, content, url, editingDocumentId, workspaceId]);

  const perform = async (operation: () => Promise<void>, savingKind?: BriefKind) => {
    setBusy(true); setError(''); setMessage('');
    if (savingKind) setSaving(savingKind);
    try {
      await operation();
      // The workspace header shows the stage and next milestone; keep it current.
      void queryClient.invalidateQueries({ queryKey: ['workspace-work', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-lifecycle', workspaceId] });
    }
    catch (error) { setError(error instanceof Error ? error.message : 'The operation failed.'); }
    finally { setBusy(false); setSaving(null); }
  };
  const savedMessage = (baseMessage: string, result: { contextRefreshed?: boolean; contextRefreshError?: string }) => {
    if (result.contextRefreshed === false) return `${baseMessage} Generated context refresh failed: ${result.contextRefreshError ?? 'run refresh and retry.'}`;
    return result.contextRefreshed === true ? `${baseMessage} Generated context refreshed.` : baseMessage;
  };
  const milestoneOptions = <>{context?.lifecycle?.steps.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</>;
  const patchAssignment = (patch: Partial<WorkGuidance['assignment']>) => setDraft((current) => current ? { ...current, assignment: { ...current.assignment, ...patch } } : current);
  const saveAssignment = () => perform(async () => {
    if (!context || !draft) return;
    const result = await apiFetch<WorkContext>(`${base}/work`, { method: 'PUT', body: JSON.stringify({
      revision: context.guidance.revision, workType: draft.workType, size: draft.size, assignment: draft.assignment,
    }) });
    setContext(result); setDraft(result.guidance); setMessage(savedMessage('AI assignment saved.', result));
  }, 'assignment');
  const saveDocument = () => perform(async () => {
    if (!context) return;
    const result = await apiFetch<WorkContext>(`${base}/work/documents${editingDocumentId ? `/${editingDocumentId}` : ''}`, {
      method: editingDocumentId ? 'PATCH' : 'POST', body: JSON.stringify({
        ...document, revision: context.guidance.revision,
        ...(!editingDocumentId ? sourceType === 'link' ? { url } : { content } : {}),
      }),
    });
    setContext(result); setDocument(emptyDocument()); setEditingDocumentId(null); setContent(''); setUrl('');
    setMessage(savedMessage('Document saved. Its role, status, and scope now appear in AI context.', result));
  });
  const saveMilestones = () => perform(async () => {
    if (!context?.lifecycle) return;
    const result = await apiFetch<{ lifecycle: WorkspaceLifecycle; contextRefreshed?: boolean; contextRefreshError?: string }>(`${base}/lifecycle/plan`, {
      method: 'PUT', body: JSON.stringify({ revision: context.lifecycle.revision ?? 0, steps }),
    });
    setContext({ ...context, lifecycle: result.lifecycle }); setSteps(result.lifecycle.steps);
    onPlanChanged(); setMessage(savedMessage('Milestones saved. Visual Flow and the Markdown plan use these same steps.', result));
  }, 'milestones');
  const removeMilestone = (stepId: string) => {
    const step = steps.find((candidate) => candidate.id === stepId);
    if (!step) return;
    const dependents = steps.filter((candidate) => candidate.id !== stepId && candidate.dependsOn?.includes(stepId));
    if (dependents.length) {
      setError(`Cannot remove “${step.title}” because ${dependents.map((candidate) => `“${candidate.title}”`).join(', ')} depend on it. Remove the dependency first.`);
      setMessage('The milestone draft was kept.');
      return;
    }
    const scopedDocuments = context?.guidance.documents.filter((document) => document.scope.milestoneId === stepId) ?? [];
    if (draft?.assignment.milestoneId === stepId || scopedDocuments.length) {
      setError(`Move the assignment${scopedDocuments.length ? ' and source document' : ''} scope away from “${step.title}” before removing it.`);
      setMessage('The milestone draft was kept.');
      return;
    }
    setError('');
    setSteps(steps.filter((candidate) => candidate.id !== stepId));
  };
  const assignmentDirty = Boolean(draft && context && !sameAssignment(pickAssignment(draft), pickAssignment(context.guidance)));
  const documentFormDirty = !sameDocumentForm({ document, sourceType, content, url }, emptyDocumentForm());
  const milestonesDirty = Boolean(context?.lifecycle && !sameSteps(steps, context.lifecycle.steps));
  const assignmentState: DraftState = conflicts.assignment ? 'conflict' : saving === 'assignment' ? 'saving' : assignmentDirty ? 'unsaved' : 'saved';
  const milestonesState: DraftState = conflicts.milestones ? 'conflict' : saving === 'milestones' ? 'saving' : milestonesDirty ? 'unsaved' : 'saved';
  const withoutConflict = (kind: BriefKind) => setConflicts((current) => ({ ...current, [kind]: undefined }));
  // The saved version stays on screen until the user chooses, so a kept draft only ever replaces it deliberately.
  const keepAssignmentDraft = () => {
    if (!context || !conflicts.assignment) return;
    setDraft({ ...context.guidance, ...mergeAssignmentDraft(conflicts.assignment, pickAssignment(context.guidance)) }); withoutConflict('assignment');
    setMessage('Your edits are applied to the latest saved assignment. Review them, then save.');
  };
  const useSavedAssignment = () => { if (context) { setDraft(context.guidance); withoutConflict('assignment'); setMessage('Using the saved assignment. Your unsaved edits were discarded.'); } };
  const keepMilestoneDraft = () => {
    if (!conflicts.milestones || !context?.lifecycle) return;
    setSteps(withSavedProgress(conflicts.milestones.value, context.lifecycle.steps)); withoutConflict('milestones');
    setMessage('Your edits are applied to the latest saved milestones. Review them, then save.');
  };
  const useSavedMilestones = () => { if (context?.lifecycle) { setSteps(context.lifecycle.steps); withoutConflict('milestones'); setMessage('Using the saved milestones. Your unsaved edits were discarded.'); } };
  const draftFirstMilestone = () => {
    if (!context?.lifecycle || steps.length || assignmentDirty) return;
    const objective = context.guidance.assignment.objective.replace(/\s+/g, ' ').trim();
    setSteps([{ id: `milestone-${crypto.randomUUID()}`, title: objective.slice(0, 100) || 'Define the first reviewable outcome', description: context.guidance.assignment.expectedOutput.trim(), status: 'pending', dependsOn: [] }]);
    setPanel('milestones');
    setMessage('First milestone drafted locally. Review its title and outcome, then save it when ready.');
  };
  return <section className="mb-5 rounded-xl border border-border bg-card p-5 space-y-4" aria-label="Work brief and sources">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Work brief & sources</h3>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>Reload brief</Button>
    </div>
    <p className="text-sm text-muted-foreground">Keep source documents here and set the AI’s current assignment. Add milestones only when this feature needs them.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error} Your draft is kept. Reload to review the latest saved version.</p>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {!context || !draft ? <p className="text-sm">{error ? 'Work brief unavailable.' : 'Loading work brief…'}</p> : <>
      {conflicts.assignment && <DraftConflictNotice noun="assignment" differences={assignmentConflicts(conflicts.assignment, pickAssignment(context.guidance))} onKeep={keepAssignmentDraft} onUseSaved={useSavedAssignment} />}
      {conflicts.milestones && context.lifecycle && <DraftConflictNotice noun="milestones" differences={stepChanges(conflicts.milestones.value, context.lifecycle.steps)} onKeep={keepMilestoneDraft} onUseSaved={useSavedMilestones} />}
      <div className="flex flex-wrap gap-2" aria-label="Brief sections">
        {(['assignment', 'documents', 'milestones', 'notes'] as const).map((item) => <Button key={item} size="sm" variant={panel === item ? 'secondary' : 'ghost'} aria-pressed={panel === item} onClick={() => { setPanel(item); if (item === 'notes') setNotesOpened(true); }}>{item === 'assignment' ? 'AI assignment' : item === 'documents' ? 'Source documents' : item === 'milestones' ? (readOnly ? 'Milestones' : context.lifecycle?.steps.length ? 'Edit milestones' : 'Add milestones') : `Delivery notes & questions${notesState === 'unsaved' ? ' (unsaved)' : notesState === 'conflict' ? ' (conflict)' : ''}`}</Button>)}
      </div>
      {notesOpened && <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0" hidden={panel !== 'notes'}><PlanningNotesPanel key={workspaceId} workspaceId={workspaceId} readOnly={readOnly} onStateChange={setNotesState} /></fieldset>}
      {panel === 'assignment' && <div className="space-y-4">
        <fieldset disabled={readOnly || Boolean(conflicts.assignment)} className="m-0 min-w-0 border-0 p-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Work type<select aria-label="Work type" className={selectClass} value={draft.workType} onChange={(event) => setDraft({ ...draft, workType: event.target.value as WorkGuidance['workType'] })}>
            {(['bug', 'feature', 'performance', 'refactor', 'rewrite'] as const).map((value) => <option key={value} value={value}>{value === 'bug' ? 'Bug fix' : value[0].toUpperCase() + value.slice(1)}</option>)}
          </select></label>
          <label className="text-sm">Size<select aria-label="Size" className={selectClass} value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value as WorkGuidance['size'] })}>
            <option value="small">Small task</option><option value="standard">Standard change</option><option value="epic">Epic / multiple deliverables</option>
          </select></label>
          <label className="text-sm">Current stage<select aria-label="Current stage" className={selectClass} value={draft.assignment.stage} onChange={(event) => patchAssignment({ stage: event.target.value as WorkGuidance['assignment']['stage'] })}>
            {stages.map((stage) => <option key={stage} value={stage}>{stage[0].toUpperCase() + stage.slice(1)}</option>)}
          </select></label>
        </div>
        <p className="text-xs text-muted-foreground">Work type and size describe the task; they do not reset progress. Edit milestones to adapt the plan.</p>
        {Boolean(context.lifecycle?.steps.length) && <label className="block text-sm">Assignment scope<select aria-label="Assignment scope" className={selectClass} value={draft.assignment.milestoneId ?? ''} onChange={(event) => patchAssignment({ milestoneId: event.target.value || undefined })}>
          <option value="">Whole workspace</option>{milestoneOptions}
        </select></label>}
        <label className="block text-sm">Current objective<Textarea className="mt-1" value={draft.assignment.objective} onChange={(event) => patchAssignment({ objective: event.target.value })} placeholder="Investigate why invoice totals differ from line items." /></label>
        <label className="block text-sm">Expected output<Textarea className="mt-1" value={draft.assignment.expectedOutput} onChange={(event) => patchAssignment({ expectedOutput: event.target.value })} placeholder="A reproduction, likely cause, and proposed test plan." /></label>
        <label className="block text-sm">Stop when<Textarea className="mt-1" value={draft.assignment.stopCondition} onChange={(event) => patchAssignment({ stopCondition: event.target.value })} placeholder="The proposal is ready for review. Stop before implementation." /></label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <Button disabled={busy || Boolean(conflicts.assignment)} onClick={() => void saveAssignment()}>Save AI assignment</Button>}
          {!readOnly && assignmentDirty && !conflicts.assignment && <Button variant="ghost" disabled={busy} onClick={() => { setDraft(context.guidance); setMessage('Unsaved assignment edits discarded.'); }}>Discard unsaved assignment changes</Button>}
          <Button variant="outline" disabled={busy || Boolean(assignmentDirty)} onClick={() => void perform(async () => {
            if (!await safeCopyToClipboard(context.assignment)) throw new Error('Could not copy the AI assignment. Check browser clipboard permissions.');
            setMessage('AI assignment copied.');
          })}>Copy AI assignment</Button>
          {!readOnly && <DraftStateLabel state={assignmentState} kept={!notKept.assignment} />}
        </div>
        {assignmentDirty && <p className="text-xs text-muted-foreground">Save your changes before copying the assignment.</p>}
        {!steps.length && !readOnly && <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <h4 className="text-sm font-semibold">No milestones saved yet</h4>
          <p className="text-xs text-muted-foreground">Turn the current assignment into a first reviewable outcome. The draft stays on this page until you save it; saving creates a pending milestone and does not start work.</p>
          <Button size="sm" variant="outline" disabled={busy || !context.lifecycle || Boolean(assignmentDirty)} onClick={draftFirstMilestone}>Draft first milestone</Button>
          {assignmentDirty && <p className="text-xs text-muted-foreground">Save the AI assignment before drafting from it.</p>}
        </div>}
      </div>}
      {panel === 'documents' && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Attach Markdown/text or link to a document. Approved requirements define intended behavior; drafts remain proposals. Superseded documents stay available as history.</p>
        {context.projectId && <p className="text-xs text-muted-foreground">Project sources are stored in the workspace where you add them. Keep that workspace while sources are active; supersede or copy them elsewhere before deleting it.</p>}
        <ul className="space-y-2">{context.guidance.documents.map((doc) => <li key={doc.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-medium text-sm">{doc.title}</p><p className="text-xs text-muted-foreground">{doc.role} · {doc.status} · {doc.scope.project ? 'Entire project' : doc.scope.milestoneId ? context.lifecycle?.steps.find((step) => step.id === doc.scope.milestoneId)?.title ?? doc.scope.milestoneId : 'Whole workspace'}</p></div>
            <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => {
              const result = await apiFetch<{ document: WorkDocument; content?: string; location: string }>(`${base}/work/documents/${doc.id}`);
              setPreview({ title: result.document.title, content: result.content, location: result.location });
            })}>Read {doc.title}</Button>{!readOnly && <Button variant="ghost" size="sm" onClick={() => { setDocument(doc); setEditingDocumentId(doc.id); }}>Edit {doc.title}</Button>}</div>
          </div>
        </li>)}</ul>
        {Boolean(context.sharedDocuments?.length) && <div className="space-y-2">
          <h4 className="font-semibold text-sm">Shared project sources</h4>
          {context.sharedDocuments!.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
            <p className="text-sm">{doc.title}<span className="block text-xs text-muted-foreground">{doc.role} · {doc.status} · managed in {doc.workspaceId}</span></p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => {
              const result = await apiFetch<{ document: WorkDocument; content?: string; location: string }>(`${base}/work/documents/${doc.id}`);
              setPreview({ title: result.document.title, content: result.content, location: result.location });
            })}>Read {doc.title}</Button>
          </div>)}
        </div>}
        {!context.guidance.documents.length && <p className="text-sm text-muted-foreground">No documents yet. Add only the sources this work needs.</p>}
        {preview && <div className="rounded-lg border border-border p-3 space-y-2"><div className="flex justify-between gap-2"><h4 className="text-sm font-semibold">{preview.title}</h4><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close document</Button></div>
          {preview.content !== undefined ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{preview.content}</pre> : <a className="text-sm text-primary underline" href={preview.location} target="_blank" rel="noopener noreferrer">Open source document</a>}
        </div>}
        {!readOnly && <div className="border-t border-border pt-4 space-y-3">
          <h4 className="font-medium text-sm">{editingDocumentId ? 'Edit document labels' : 'Add source document'}</h4>
          <label className="block text-sm">Document title<Input value={document.title} onChange={(event) => setDocument({ ...document, title: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Document role<select aria-label="Document role" className={selectClass} value={document.role} onChange={(event) => setDocument({ ...document, role: event.target.value as WorkDocument['role'] })}>
              {(['requirements', 'design', 'evidence', 'reference'] as const).map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
            </select></label>
            <label className="text-sm">Document status<select aria-label="Document status" className={selectClass} value={document.status} onChange={(event) => setDocument({ ...document, status: event.target.value as WorkDocument['status'] })}>
              <option value="draft">Draft</option><option value="approved">Approved</option><option value="superseded">Superseded</option>
            </select></label>
          </div>
          <label className="block text-sm">Document scope<select aria-label="Document scope" className={selectClass} value={document.scope.project ? 'project' : document.scope.milestoneId ? `milestone:${document.scope.milestoneId}` : ''} onChange={(event) => setDocument({ ...document, scope: event.target.value === 'project' ? { project: true } : { milestoneId: event.target.value.replace(/^milestone:/, '') || undefined } })}>
            <option value="">Whole workspace</option>{context.projectId && <option value="project">Entire project (shared)</option>}
            {context.lifecycle?.steps.map((step) => <option key={step.id} value={`milestone:${step.id}`}>{step.title}</option>)}
          </select></label>
          {!editingDocumentId && <>
            <label className="block text-sm">Document source<select aria-label="Document source" className={selectClass} value={sourceType} onChange={(event) => setSourceType(event.target.value as 'text' | 'link')}><option value="text">Upload or paste Markdown/text</option><option value="link">Link to a document</option></select></label>
            {sourceType === 'link' ? <label className="block text-sm">Document URL<Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label> : <>
              <label className="block text-sm">Upload text document<input type="file" className="mt-1 block w-full text-sm" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void perform(async () => {
                  if (file.size > 500_000 || !/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Choose a Markdown or text file up to 500 KB. Link to other document formats.');
                  setContent(await file.text()); setDocument((current) => ({ ...current, title: current.title || file.name }));
                });
              }} /></label>
              <label className="block text-sm">Source text<Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} /></label>
            </>}
          </>}
          <label className="block text-sm">Owner summary (optional)<Textarea value={document.summary} onChange={(event) => setDocument({ ...document, summary: event.target.value })} placeholder="Highlight what matters for this task. The original remains available." /></label>
          <div className="flex gap-2"><Button disabled={busy || !document.title.trim() || (!editingDocumentId && !(sourceType === 'link' ? url.trim() : content.trim()))} onClick={() => void saveDocument()}>{editingDocumentId ? 'Save document labels' : 'Add document'}</Button>
            {editingDocumentId && <Button variant="ghost" onClick={() => { setEditingDocumentId(null); setDocument(emptyDocument()); }}>Cancel document edit</Button>}
            {!editingDocumentId && documentFormDirty && <Button variant="ghost" disabled={busy} onClick={() => { setDocument(emptyDocument()); setSourceType('text'); setContent(''); setUrl(''); setMessage('Unsaved source document discarded.'); }}>Discard unsaved source document</Button>}
            {!editingDocumentId && documentFormDirty && <DraftStateLabel state="unsaved" kept={!notKept.document} keptText="Unsaved — kept until you close this window" />}
          </div>
        </div>}
      </div>}
      {panel === 'milestones' && <fieldset disabled={readOnly || Boolean(conflicts.milestones)} className="m-0 min-w-0 border-0 p-0 space-y-4">
        <p className="text-sm text-muted-foreground">Milestones are optional and unique to this feature. Name the outcomes you need, or remove all milestones to hide the flow.</p>
        {!context.lifecycle?.steps.length && steps.length > 0 && <p className="text-xs text-muted-foreground">This milestone is an unsaved draft. Review its title and outcome; Save milestones creates it as pending and does not start work.</p>}
        {steps.map((step, index) => <fieldset key={step.id} className="rounded-lg border border-border p-3 space-y-3">
          <legend className="px-1 text-xs text-muted-foreground">Milestone {index + 1} · {step.status.replaceAll('_', ' ')}</legend>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeMilestone(step.id)}>Remove milestone {index + 1}</Button>
          <label className="block text-sm">Milestone {index + 1} title<Input value={step.title} onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, title: event.target.value } : item))} /></label>
          <label className="block text-sm">Milestone {index + 1} outcome<Textarea value={step.description ?? ''} onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, description: event.target.value } : item))} /></label>
          <label className="block text-sm">Milestone {index + 1} branch (optional)<Input value={step.branch ?? ''} placeholder="feature/invoice-calculation" onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, branch: event.target.value } : item))} /></label>
          <label className="block text-sm">Milestone {index + 1} repository (optional)<Input value={step.repo ?? ''} placeholder="billing-api" onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, repo: event.target.value } : item))} /></label>
          <label className="block text-sm">Milestone {index + 1} work item / PR (optional)<Input value={step.workItem ?? ''} placeholder="PBI ID or URL" onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, workItem: event.target.value } : item))} /></label>
          <label className="block text-sm">Milestone {index + 1} unblock condition (optional)<Input value={step.unblockCondition ?? ''} placeholder="Dependency or decision needed before starting" onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, unblockCondition: event.target.value } : item))} /></label>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm">Milestone {index + 1} dependencies</legend>
            {steps.filter((item) => item.id !== step.id).map((item) => <label key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(step.dependsOn?.includes(item.id))} onChange={(event) => setSteps(steps.map((candidate) => candidate.id === step.id ? {
                ...candidate, dependsOn: event.target.checked ? [...(candidate.dependsOn ?? []), item.id] : (candidate.dependsOn ?? []).filter((id) => id !== item.id),
              } : candidate))} />{item.title || 'Untitled milestone'}
            </label>)}
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(step.requiresVerification || step.verificationCommand)} disabled={step.status === 'completed'} onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, requiresVerification: event.target.checked, ...(!event.target.checked ? { verificationCommand: '' } : {}) } : item))} />Verify before completing milestone {index + 1}</label>
          {(step.requiresVerification || step.verificationCommand) && <label className="block text-sm">Milestone {index + 1} verification command (optional)<Input value={step.verificationCommand ?? ''} disabled={step.status === 'completed'} placeholder="Uses the workspace test command unless overridden" onChange={(event) => setSteps(steps.map((item) => item.id === step.id ? { ...item, verificationCommand: event.target.value } : item))} /></label>}
          {(step.requiresVerification || step.verificationCommand) && <label className="block text-sm">Milestone {index + 1} verification time limit in minutes (optional)<Input type="number" min={1} max={120} step={1} value={step.verificationTimeoutSeconds ? Math.round(step.verificationTimeoutSeconds / 60) : ''} placeholder="30" onChange={(event) => {
            const minutes = Number.parseInt(event.target.value, 10);
            setSteps(steps.map((item) => item.id === step.id ? { ...item, verificationTimeoutSeconds: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 120) * 60 : undefined } : item));
          }} /></label>}
        </fieldset>)}
        {!readOnly && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || steps.length >= 100} onClick={() => setSteps([...steps, { id: `milestone-${crypto.randomUUID()}`, title: '', status: 'pending', dependsOn: [] }])}>Add milestone</Button><Button disabled={busy || steps.some((step) => !step.title.trim())} onClick={() => void saveMilestones()}>Save milestones</Button>
          {milestonesDirty && <Button variant="ghost" disabled={busy} onClick={() => { setSteps(context.lifecycle?.steps ?? []); setMessage('Unsaved milestone edits discarded.'); }}>Discard unsaved milestone changes</Button>}
          <DraftStateLabel state={milestonesState} kept={!notKept.milestones} /></div>}
      </fieldset>}
    </>}
  </section>;
}
