import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import type { DocumentKind, DocumentPreviewData } from './DocumentPreview.js';
import { DocumentViewer } from './DocumentViewer.js';
import type { MarkdownDocumentLinks } from '../../components/ChatMarkdown.js';

type RootDocument = { name: string; size: number; modifiedAt: string; kind: DocumentKind };
type Preview = DocumentPreviewData;

export function RootDocumentsPanel({ workspaceId, workspacePath }: { workspaceId: string; workspacePath?: string }) {
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
  // Documents opened from a link, so Back returns to the one that linked them.
  const [trail, setTrail] = useState<string[]>([]);
  const base = `/api/workspace/${encodeURIComponent(workspaceId)}/documents`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError('');
    void apiFetch<{ documents: RootDocument[] }>(base, { signal: controller.signal }).then((result) => {
      setDocuments(result.documents);
      // Linked files in subfolders are not listed; keep them open across a refresh.
      setSelected((current) => current && (current.includes('/') || result.documents.some((doc) => doc.name === current)) ? current : null);
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

  const fileUrlFor = useCallback((name: string) => `${API_BASE}${base}/file?name=${encodeURIComponent(name)}`, [base]);
  const fileUrl = selected ? fileUrlFor(selected) : '';
  const choose = (name: string | null) => { setTrail([]); setSelected(name); };
  const links = useMemo<MarkdownDocumentLinks | undefined>(() => selected ? {
    workspaceRoot: workspacePath,
    documentPath: selected,
    fileUrl: fileUrlFor,
    onOpenFile: (name) => {
      if (name === selected) return;
      setTrail((previous) => [...previous, selected]);
      setSelected(name);
    },
  } : undefined, [fileUrlFor, selected, workspacePath]);
  const back = trail.at(-1);
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
          <button type="button" aria-pressed={selected === doc.name} className={`w-full rounded-lg p-2 text-left text-sm hover:bg-accent ${selected === doc.name ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => choose(doc.name)}>
            <span className="flex gap-2 items-start"><FileText size={15} className="mt-0.5 shrink-0" /><span className="break-all">{doc.name}</span></span>
            <span className="block pl-6 text-xs text-muted-foreground">{Math.max(1, Math.ceil(doc.size / 1024))} KB · {new Date(doc.modifiedAt).toLocaleDateString()}</span>
          </button>
        </li>)}</ul>
      </aside>
      <article aria-label="Document preview" className="min-w-0 rounded-xl border border-border bg-card p-4 space-y-4">
        {!selected ? <p className="text-sm text-muted-foreground">Select a document to open it here.</p> : <>
          {back && <Button size="sm" variant="ghost" className="-ml-2" onClick={() => { setTrail((previous) => previous.slice(0, -1)); setSelected(back); }}>
            <ArrowLeft size={14} />Back to {back.split('/').pop()}
          </Button>}
          <DocumentViewer
            title={selected}
            preview={preview}
            raw={raw}
            onToggleRaw={preview?.kind === 'markdown' || preview?.kind === 'html' ? () => setRaw((value) => !value) : undefined}
            downloadHref={`${fileUrl}&download=1`}
            onClose={() => choose(null)}
            fileUrl={`${fileUrl}&revision=${revision}`}
            links={links}
            status={<>
              {opening && <p role="status" className="text-sm text-muted-foreground">Opening document…</p>}
              {previewError && <p role="alert" className="text-sm text-destructive">{previewError} <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry preview</Button></p>}
            </>}
          />
        </>}
      </article>
    </div>
  </section>;
}
