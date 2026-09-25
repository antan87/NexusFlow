import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api/client.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';

export function PlanningNotesPanel({ workspaceId }: { workspaceId: string }) {
  const [saved, setSaved] = useState<{ content: string; revision: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/workspace/${encodeURIComponent(workspaceId)}/planning-notes`;
  const load = async (signal?: AbortSignal) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ content: string; revision: string }>(endpoint, { signal });
      if (signal?.aborted) return;
      setSaved(result); setDraft(result.content);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Could not load planning notes.'); }
    finally { if (!signal?.aborted) setBusy(false); }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [endpoint]);
  const save = async () => {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ content: string; revision: string; contextRefreshed?: boolean; contextRefreshError?: string }>(endpoint, { method: 'PUT', body: JSON.stringify({ revision: saved.revision, content: draft }) });
      setSaved(result);
      setMessage(result.contextRefreshed === false
        ? `Delivery notes saved, but generated context refresh failed: ${result.contextRefreshError ?? 'run refresh and retry.'}`
        : result.contextRefreshed === true ? 'Delivery notes saved. Generated context refreshed.' : 'Delivery notes saved. Refresh will preserve them.');
    } catch (error) { setError(`${error instanceof Error ? error.message : 'Could not save.'} Your draft is kept.`); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Authored delivery order, open questions, existing work, and flag-only decisions. Edit the tables as Markdown; this document survives refresh. Use Edit milestones for gates and progress.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <label className="block text-sm">Delivery notes<Textarea aria-label="Delivery notes" rows={20} style={{ fieldSizing: 'fixed', height: '24rem', resize: 'vertical' }} className="mt-2 font-mono text-xs" value={draft} disabled={busy || !saved} onChange={(event) => setDraft(event.target.value)} /></label>
    <div className="flex gap-2"><Button disabled={busy || !saved || draft === saved.content} onClick={() => void save()}>Save delivery notes</Button><Button variant="outline" disabled={busy} onClick={() => void load()}>Reload delivery notes</Button></div>
    <p className="text-xs text-muted-foreground">Stored in contextspace-milestones.md. Reload replaces your draft with the saved document.</p>
  </div>;
}
