import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import type { WorkDocument } from '../../types.js';
import type { DocumentKind, DocumentPreviewData } from '../work-guidance/DocumentPreview.js';
import { useFloatingChat } from '../chat/floatingChatStore.js';

const DocumentPreview = lazy(() => import('../work-guidance/DocumentPreview.js').then(module => ({ default: module.DocumentPreview })));
type RootDocument = { name: string; kind: DocumentKind; modifiedAt: string };
type SourceDocument = WorkDocument & { workspaceId?: string };

export function WorkspaceDocumentsInspector({ workspace, openDocument }: { workspace: string; openDocument?: { name: string; id: number } | null }) {
  const { isMaximized, toggleMaximize } = useFloatingChat();
  const handledDocument = useRef(0);
  const [files, setFiles] = useState<RootDocument[]>([]);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [selected, setSelected] = useState<{ type: 'file' | 'source'; id: string } | null>(null);
  const [preview, setPreview] = useState<DocumentPreviewData | null>(null);
  const [sourcePreview, setSourcePreview] = useState<{ content?: string; location: string } | null>(null);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/workspace/${encodeURIComponent(workspace)}`;

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void apiFetch<{ documents: RootDocument[] }>(`${base}/documents`, { signal: controller.signal })
      .then(result => setFiles(result.documents))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load workspace files.'); });
    void apiFetch<{ guidance: { documents: WorkDocument[] }; sharedDocuments?: SourceDocument[] }>(`${base}/work`, { signal: controller.signal })
      .then(result => setSources([...result.guidance.documents, ...(result.sharedDocuments ?? [])]))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load source documents.'); });
    return () => controller.abort();
  }, [base, revision]);

  useEffect(() => {
    if (openDocument && openDocument.id !== handledDocument.current && files.some(file => file.name === openDocument.name)) {
      handledDocument.current = openDocument.id;
      setSelected({ type: 'file', id: openDocument.name });
    }
  }, [files, openDocument]);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setSourcePreview(null); setRaw(false); setError('');
    if (!selected) return () => controller.abort();
    const request = selected.type === 'file'
      ? apiFetch<DocumentPreviewData>(`${base}/documents/preview?name=${encodeURIComponent(selected.id)}`, { signal: controller.signal }).then(setPreview)
      : apiFetch<{ content?: string; location: string }>(`${base}/work/documents/${encodeURIComponent(selected.id)}`, { signal: controller.signal }).then(setSourcePreview);
    void request.catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open document.'); });
    return () => controller.abort();
  }, [base, selected, revision]);

  const visibleFiles = useMemo(() => files.filter(file => file.name.toLowerCase().includes(query.toLowerCase())), [files, query]);
  const visibleSources = useMemo(() => sources.filter(source => `${source.title} ${source.role} ${source.status}`.toLowerCase().includes(query.toLowerCase())), [sources, query]);
  const fileUrl = selected?.type === 'file' ? `${API_BASE}${base}/documents/file?name=${encodeURIComponent(selected.id)}` : '';

  return <section aria-label="Workspace documents" className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex items-center gap-2 border-b border-border p-2">
      <span className="text-xs font-semibold">Documents</span>
      {!isMaximized && <Button size="xs" variant="ghost" onClick={toggleMaximize}>Expand chat</Button>}
      <Button size="xs" variant="ghost" aria-label="Refresh documents" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-3" /></Button>
    </div>
    <div className="max-h-[38%] min-h-32 space-y-2 overflow-auto border-b border-border p-2">
      <Input aria-label="Find a document" placeholder="Find a document…" value={query} onChange={event => setQuery(event.target.value)} />
      <p className="text-[11px] font-semibold text-muted-foreground">Workspace files</p>
      {visibleFiles.map(file => <button key={file.name} type="button" aria-pressed={selected?.type === 'file' && selected.id === file.name}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
        onClick={() => setSelected({ type: 'file', id: file.name })}><FileText className="size-3 shrink-0" /><span className="truncate">{file.name}</span></button>)}
      {!visibleFiles.length && <p className="text-xs text-muted-foreground">No matching files.</p>}
      <p className="pt-2 text-[11px] font-semibold text-muted-foreground">Source documents</p>
      {visibleSources.map(source => <button key={source.id} type="button" aria-pressed={selected?.type === 'source' && selected.id === source.id}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
        onClick={() => setSelected({ type: 'source', id: source.id })}><span className="truncate">{source.title}</span><span className="shrink-0 text-[10px] text-muted-foreground">{source.status}</span></button>)}
      {!visibleSources.length && <p className="text-xs text-muted-foreground">No matching sources.</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {!selected && <p className="text-xs text-muted-foreground">Select a file or source to read beside the CLI session.</p>}
      {selected && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="break-all text-xs font-semibold">{selected.type === 'file' ? selected.id : sources.find(source => source.id === selected.id)?.title}</h3>
        <div className="flex gap-2 text-xs">
          {(sourcePreview?.content !== undefined || (preview && (preview.kind === 'html' || preview.kind === 'markdown'))) && <Button size="xs" variant="outline" onClick={() => setRaw(value => !value)}>{raw ? 'Rendered' : 'Raw'}</Button>}
          {selected.type === 'file' && <a className="text-primary underline" href={`${fileUrl}&download=1`} download={selected.id}>Download</a>}
        </div>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {preview && <Suspense fallback={<p role="status" className="text-xs">Opening viewer…</p>}><DocumentPreview preview={preview} fileUrl={fileUrl} raw={raw} /></Suspense>}
      {sourcePreview?.content !== undefined && <Suspense fallback={<p role="status" className="text-xs">Opening viewer…</p>}><DocumentPreview preview={{ name: selected?.id ?? 'Source document', kind: 'markdown', content: sourcePreview.content }} fileUrl="" raw={raw} /></Suspense>}
      {sourcePreview?.content === undefined && sourcePreview?.location && <a className="text-xs text-primary underline" href={sourcePreview.location} target="_blank" rel="noopener noreferrer">Open source document</a>}
    </div>
  </section>;
}
