import { useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import { DocumentPreview, type DocumentKind, type DocumentPreviewData } from './DocumentPreview.js';

type RootDocument = { name: string; size: number; modifiedAt: string; kind: DocumentKind };
type Preview = DocumentPreviewData;

export function RootDocumentsPanel({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<RootDocument[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [listError, setListError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [raw, setRaw] = useState(false);
  const base = `/api/workspace/${encodeURIComponent(workspaceId)}/documents`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError('');
    void apiFetch<{ documents: RootDocument[] }>(base, { signal: controller.signal }).then((result) => {
      setDocuments(result.documents);
      setSelected((current) => result.documents.some((doc) => doc.name === current) ? current : null);
    }).catch((error) => {
      if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'Unable to load documents.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setPreviewError(''); setRaw(false);
    if (!selected) { setOpening(false); return () => controller.abort(); }
    setOpening(true);
    void apiFetch<Preview>(`${base}/preview?name=${encodeURIComponent(selected)}`, { signal: controller.signal }).then(setPreview).catch((error) => {
      if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Unable to open document.');
    }).finally(() => { if (!controller.signal.aborted) setOpening(false); });
    return () => controller.abort();
  }, [base, selected, revision]);

  const fileUrl = selected ? `${API_BASE}${base}/file?name=${encodeURIComponent(selected)}` : '';
  const visible = documents.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase()));

  return <section aria-label="Workspace documents" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Documents</h2><p className="text-sm text-muted-foreground">Files in the workspace root, including documents created by your agents.</p></div>
      <Button variant="outline" disabled={loading || opening} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} />Refresh documents</Button>
    </header>
    {listError && <div role="alert" className="text-sm text-destructive">{listError} <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry documents</Button></div>}
    <div className="grid gap-4 lg:grid-cols-[minmax(200px,280px)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border bg-card p-3 space-y-3">
        <Input aria-label="Filter documents" placeholder="Filter documents…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading documents…</p> : !listError && !documents.length ? <p className="text-sm text-muted-foreground">No documents in the workspace root yet. Refresh after a file is created.</p> : !visible.length && <p className="text-sm text-muted-foreground">No matching documents.</p>}
        <ul className="max-h-[65vh] overflow-y-auto space-y-1">{visible.map((doc) => <li key={doc.name}>
          <button type="button" aria-pressed={selected === doc.name} className={`w-full rounded-lg p-2 text-left text-sm hover:bg-accent ${selected === doc.name ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSelected(doc.name)}>
            <span className="flex gap-2 items-start"><FileText size={15} className="mt-0.5 shrink-0" /><span className="break-all">{doc.name}</span></span>
            <span className="block pl-6 text-xs text-muted-foreground">{Math.max(1, Math.ceil(doc.size / 1024))} KB · {new Date(doc.modifiedAt).toLocaleDateString()}</span>
          </button>
        </li>)}</ul>
      </aside>
      <article aria-label="Document preview" className="min-w-0 rounded-xl border border-border bg-card p-4 space-y-4">
        {!selected ? <p className="text-sm text-muted-foreground">Select a document to open it here.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold break-all">{selected}</h3>
            <div className="flex items-center gap-3 text-sm">
              {(preview?.kind === 'markdown' || preview?.kind === 'html') && <Button size="sm" variant="outline" onClick={() => setRaw((value) => !value)}>{raw ? 'Rendered view' : 'Raw text'}</Button>}
              <a href={`${fileUrl}&download=1`} download={selected} className="text-primary underline">Download</a>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close document</Button>
            </div>
          </div>
          {opening && <p role="status" className="text-sm text-muted-foreground">Opening document…</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">{previewError} <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry preview</Button></p>}
          {preview && <div className="max-h-[70vh] overflow-auto"><DocumentPreview preview={preview} fileUrl={`${fileUrl}&revision=${revision}`} raw={raw} /></div>}
        </>}
      </article>
    </div>
  </section>;
}
