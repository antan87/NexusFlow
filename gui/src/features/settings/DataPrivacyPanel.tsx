import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';

interface DataClass { id: string; title: string; owner: string; storage: string; network: string; retention: string; controls: string; recovery: string }
interface Guide { classes: DataClass[]; locations: Record<string, string>; locationNotice: string }
type Section = 'runtime' | 'workspace' | 'checks';
interface Report { schemaVersion: 1; purpose: string; sections: Partial<Record<Section, unknown>>; omittedSections: Section[]; excludedData: string[] }
interface Preview { report: Report; content: string; digest: string }
const sectionLabels: Record<Section, string> = { runtime: 'Runtime versions and platform', workspace: 'Workspace counts and storage type', checks: 'File and repository status checks' };

export function DataPrivacyPanel({ workspaces }: { workspaces: { id: string; branchName: string }[] }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [guideError, setGuideError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [workspaceId, setWorkspaceId] = useState('');
  const [source, setSource] = useState<Report | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [omitted, setOmitted] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setGuideError(false);
    apiFetch<Guide>('/api/data-guide').then(data => { if (!cancelled) setGuide(data); })
      .catch(() => { if (!cancelled) setGuideError(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  async function collect() {
    setBusy(true); setError(''); setNotice(''); setPreview(null); setSource(null); setOmitted([]);
    try {
      const result = await apiFetch<Preview>('/api/diagnostics/preview', {
        method: 'POST', body: JSON.stringify(workspaceId ? { workspaceId } : {}),
      });
      setSource(result.report); setPreview(result);
    } catch { setError('Could not collect diagnostics. Check the workspace and try again.'); }
    finally { setBusy(false); }
  }

  async function toggle(section: Section) {
    if (!source) return;
    const next = omitted.includes(section) ? omitted.filter(key => key !== section) : [...omitted, section];
    const previous = omitted;
    setOmitted(next);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<Preview>('/api/diagnostics/review', {
        method: 'POST', body: JSON.stringify({ report: source, omit: next }),
      });
      setPreview(result);
    } catch { setOmitted(previous); setError('Could not update the preview. The previous reviewed selection is unchanged.'); }
    finally { setBusy(false); }
  }

  async function download() {
    if (!preview) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API_BASE}/api/diagnostics/export`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: preview.report, digest: preview.digest }),
      });
      const content = await response.text();
      if (!response.ok || content !== preview.content) throw new Error();
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'contextspace-diagnostics.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Download prepared. Your browser controls where the file is saved. Nothing was uploaded.');
    } catch { setError('Could not export this preview. Your source data is unchanged; review and try again.'); }
    finally { setBusy(false); }
  }

  return <Card id="data-and-privacy" className="mb-6 space-y-5 p-6">
    <div>
      <h2 className="text-lg font-semibold">Data and privacy</h2>
      <p className="mt-1 text-sm text-muted-foreground">Understand what is stored, what can leave this device, and what deletion affects.</p>
    </div>
    {guideError ? <div role="alert">The data guide could not be loaded. <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry guide</Button></div>
      : !guide ? <p role="status">Loading data guide…</p>
      : <>
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Local profile locations</summary>
          <p className="my-2 text-xs text-muted-foreground">{guide.locationNotice}</p>
          <dl className="space-y-2 text-xs">{Object.entries(guide.locations).map(([key, value]) => <div key={key}><dt className="font-medium">{key}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl>
        </details>
        <div className="grid gap-2 md:grid-cols-2">{guide.classes.map(item => <details key={item.id} className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{item.title}</summary>
          <dl className="mt-3 space-y-3 text-xs leading-relaxed">{(['owner', 'storage', 'network', 'retention', 'controls', 'recovery'] as const).map(key =>
            <div key={key}><dt className="font-semibold capitalize">{key}</dt><dd className="text-muted-foreground">{item[key]}</dd></div>)}</dl>
        </details>)}</div>
      </>}
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Review a support report</h3>
      <p className="text-sm text-muted-foreground">Status fields only. No code, authored documents, transcripts, raw logs, credentials, full settings, or environment values. Workspace and repository names become aliases. This report cannot restore your work.</p>
      <label className="block text-sm">Report scope
        <select aria-label="Report scope" className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={workspaceId} disabled={busy || source !== null} onChange={event => setWorkspaceId(event.target.value)}>
          <option value="">Runtime only</option>
          {workspaces.map(ws => <option key={ws.id} value={ws.id}>{ws.branchName}</option>)}
        </select>
      </label>
      {!source && <Button onClick={() => void collect()} disabled={busy}>{busy ? 'Collecting…' : 'Preview diagnostics'}</Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {source && preview && <>
        <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-sm font-medium">Include in this report</legend>
          {(Object.keys(sectionLabels) as Section[]).filter(key => source.sections[key] !== undefined).map(key => <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!omitted.includes(key)} onChange={() => void toggle(key)} />{sectionLabels[key]}
          </label>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">Review the exact file below. Removing a section updates this captured report; it does not collect new data.</p>
        <pre aria-label="Diagnostic file preview" aria-busy={busy} tabIndex={0} className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{preview.content}</pre>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void download()} disabled={busy}>Download reviewed report</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setSource(null); setPreview(null); setError(''); setNotice('Preview discarded. No file was exported.'); }}>Cancel preview</Button>
        </div>
      </>}
    </div>
  </Card>;
}
