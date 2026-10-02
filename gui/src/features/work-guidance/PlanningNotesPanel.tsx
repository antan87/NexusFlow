import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api/client.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { DraftStateLabel, NotesConflictNotice, type DraftState } from './BriefDraftNotices.js';
import { clearDraft, readDraft, reconcileNotes, writeDraft, type StoredDraft } from './briefDrafts.js';

export function PlanningNotesPanel({ workspaceId, readOnly = false, onStateChange }: { workspaceId: string; /** Archived: show the saved notes and keep no draft. */ readOnly?: boolean; onStateChange?: (state: DraftState) => void }) {
  const [saved, setSaved] = useState<{ content: string; revision: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [conflict, setConflict] = useState<StoredDraft<string> | null>(null);
  const [kept, setKept] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // The latest unsaved notes, so a reload still finds them when this device cannot store drafts.
  const live = useRef<StoredDraft<string> | null>(null);
  const endpoint = `/api/workspace/${encodeURIComponent(workspaceId)}/planning-notes`;
  const load = async (signal?: AbortSignal) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ content: string; revision: string }>(endpoint, { signal });
      if (signal?.aborted) return;
      const decision = readOnly ? { kind: 'none' as const } : reconcileNotes(live.current ?? readDraft('notes', workspaceId), result);
      if (decision.kind === 'none' && !readOnly) clearDraft('notes', workspaceId);
      live.current = decision.kind === 'conflict' ? decision.draft : null;
      setSaved(result); setConflict(decision.kind === 'conflict' ? decision.draft : null);
      setDraft(decision.kind === 'restore' ? decision.value : result.content);
      if (decision.kind === 'restore') setMessage('Unsaved delivery notes kept. Save them, or discard them.');
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Could not load planning notes.'); }
    finally { if (!signal?.aborted) setBusy(false); }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [endpoint]);

  // Keep unsaved notes on this device as they are typed. A pending conflict owns the stored draft until the user chooses.
  useEffect(() => {
    if (readOnly || !saved || conflict) return;
    if (draft === saved.content) {
      live.current = null; clearDraft('notes', workspaceId); setKept(true);
      return;
    }
    live.current = { base: saved.revision, value: draft, savedAt: Date.now() };
    setKept(writeDraft('notes', workspaceId, saved.revision, draft));
  }, [readOnly, saved, draft, conflict, workspaceId]);

  const dirty = Boolean(saved) && draft !== saved?.content;
  const state: DraftState = conflict ? 'conflict' : saving ? 'saving' : dirty ? 'unsaved' : 'saved';
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  const save = async () => {
    if (!saved) return;
    setBusy(true); setSaving(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ content: string; revision: string; contextRefreshed?: boolean; contextRefreshError?: string }>(endpoint, { method: 'PUT', body: JSON.stringify({ revision: saved.revision, content: draft }) });
      setSaved(result); setDraft(result.content);
      setMessage(result.contextRefreshed === false
        ? `Delivery notes saved, but generated context refresh failed: ${result.contextRefreshError ?? 'run refresh and retry.'}`
        : result.contextRefreshed === true ? 'Delivery notes saved. Generated context refreshed.' : 'Delivery notes saved. Refresh will preserve them.');
    } catch (error) { setError(`${error instanceof Error ? error.message : 'Could not save.'} Your draft is kept.`); }
    finally { setBusy(false); setSaving(false); }
  };
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Authored delivery order, open questions, existing work, and flag-only decisions. Edit the tables as Markdown; this document survives refresh. Use Edit milestones for gates and progress.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {conflict && saved && <NotesConflictNotice mine={conflict.value} saved={saved.content}
      onKeep={() => { setDraft(conflict.value); setConflict(null); setMessage('Your notes are in the editor over the latest saved version. Review them, then save.'); }}
      onUseSaved={() => { setDraft(saved.content); setConflict(null); setMessage('Using the saved notes. Your unsaved edits were discarded.'); }} />}
    <label className="block text-sm">Delivery notes<Textarea aria-label="Delivery notes" rows={20} style={{ fieldSizing: 'fixed', height: '24rem', resize: 'vertical' }} className="mt-2 font-mono text-xs" value={draft} disabled={busy || !saved || Boolean(conflict)} onChange={(event) => setDraft(event.target.value)} /></label>
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy || !saved || draft === saved.content || Boolean(conflict)} onClick={() => void save()}>Save delivery notes</Button>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>Reload delivery notes</Button>
      {dirty && !conflict && <Button variant="ghost" disabled={busy} onClick={() => { if (saved) { setDraft(saved.content); setMessage('Unsaved delivery notes discarded.'); } }}>Discard unsaved delivery notes</Button>}
      {!readOnly && <DraftStateLabel state={state} kept={kept} />}
    </div>
    <p className="text-xs text-muted-foreground">Stored in contextspace-milestones.md. Reload fetches the saved document and keeps your unsaved draft unless the saved notes changed; then you choose.</p>
  </div>;
}
