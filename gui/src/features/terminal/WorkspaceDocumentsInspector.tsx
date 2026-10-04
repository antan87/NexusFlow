import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import type { WorkDocument } from '../../types.js';
import type { DocumentKind, DocumentPreviewData } from '../work-guidance/DocumentPreview.js';
import type { MarkdownDocumentLinks } from '../../components/ChatMarkdown.js';
import { usePaneHotkey } from './usePaneHotkey.js';

const DocumentViewer = lazy(() => import('../work-guidance/DocumentViewer.js').then(module => ({ default: module.DocumentViewer })));
type RootDocument = { name: string; kind: DocumentKind; modifiedAt: string };
type SourceDocument = WorkDocument & { workspaceId?: string };

export function WorkspaceDocumentsInspector({ workspace, workspacePath, active = true, openDocument }: { workspace: string; workspacePath?: string; active?: boolean; openDocument?: { name: string; id: number } | null }) {
  const handledDocument = useRef(0);
  const [files, setFiles] = useState<RootDocument[]>([]);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [selected, setSelected] = useState<{ type: 'file' | 'source'; id: string } | null>(null);
  // Documents opened from a link, so Back returns to the one that linked them.
  const [trail, setTrail] = useState<string[]>([]);
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

  const choose = useCallback((next: { type: 'file' | 'source'; id: string }) => { setTrail([]); setSelected(next); }, []);

  useEffect(() => {
    if (!openDocument || openDocument.id === handledDocument.current) return;
    // Documents in folders are not in the root listing; the caller has already asked the server to open them.
    if (openDocument.name.includes('/') || files.some(file => file.name === openDocument.name)) {
      handledDocument.current = openDocument.id;
      choose({ type: 'file', id: openDocument.name });
    }
  }, [files, openDocument, choose]);

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

  // The whole document list, flattened, so Alt+Arrow can walk it in reading
  // order: workspace files first, then source documents.
  const allSelectable = useMemo(
    () => [
      ...visibleFiles.map(file => ({ type: 'file' as const, id: file.name })),
      ...visibleSources.map(source => ({ type: 'source' as const, id: source.id })),
    ],
    [visibleFiles, visibleSources],
  );

  const step = useCallback((delta: number) => {
    if (!allSelectable.length) return;
    const index = selected
      ? allSelectable.findIndex(item => item.type === selected.type && item.id === selected.id)
      : -1;
    const next = index === -1
      ? (delta > 0 ? 0 : allSelectable.length - 1)
      : Math.min(allSelectable.length - 1, Math.max(0, index + delta));
    const target = allSelectable[next];
    if (target) choose(target);
  }, [allSelectable, selected, choose]);

  usePaneHotkey((event) => {
    if (!event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
  }, { respectTerminal: false, enabled: active });
  const fileUrlFor = useCallback((name: string) => `${API_BASE}${base}/documents/file?name=${encodeURIComponent(name)}`, [base]);
  const fileUrl = selected?.type === 'file' ? fileUrlFor(selected.id) : '';
  const links = useMemo<MarkdownDocumentLinks | undefined>(() => selected?.type === 'file' ? {
    workspaceRoot: workspacePath,
    documentPath: selected.id,
    fileUrl: fileUrlFor,
    onOpenFile: name => {
      if (name === selected.id) return;
      setTrail(previous => [...previous, selected.id]);
      setSelected({ type: 'file', id: name });
    },
  } : undefined, [fileUrlFor, selected, workspacePath]);
  const back = trail.at(-1);

  return <section aria-label="Workspace documents" className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex items-center gap-2 border-b border-border p-2">
      <span className="text-xs font-semibold">Documents</span>
      <span className="ml-auto text-[10px] text-muted-foreground" aria-hidden="true">Alt+↑ / Alt+↓</span>
      <Button size="xs" variant="ghost" aria-label="Refresh documents" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-3" /></Button>
    </div>
    <div className="max-h-[38%] min-h-32 space-y-2 overflow-auto border-b border-border p-2">
      <Input aria-label="Find a document" placeholder="Find a document…" value={query} onChange={event => setQuery(event.target.value)} />
      <p className="text-[11px] font-semibold text-muted-foreground">Workspace files</p>
      {visibleFiles.map(file => <button key={file.name} type="button" aria-pressed={selected?.type === 'file' && selected.id === file.name}
        aria-keyshortcuts="Alt+ArrowDown Alt+ArrowUp"
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
        onClick={() => choose({ type: 'file', id: file.name })}><FileText className="size-3 shrink-0" /><span className="truncate">{file.name}</span></button>)}
      {!visibleFiles.length && <p className="text-xs text-muted-foreground">No matching files.</p>}
      <p className="pt-2 text-[11px] font-semibold text-muted-foreground">Source documents</p>
      {visibleSources.map(source => <button key={source.id} type="button" aria-pressed={selected?.type === 'source' && selected.id === source.id}
        aria-keyshortcuts="Alt+ArrowDown Alt+ArrowUp"
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
        onClick={() => choose({ type: 'source', id: source.id })}><span className="truncate">{source.title}</span><span className="shrink-0 text-[10px] text-muted-foreground">{source.status}</span></button>)}
      {!visibleSources.length && <p className="text-xs text-muted-foreground">No matching sources.</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {!selected && <p className="text-xs text-muted-foreground">Select a file or source to read beside the CLI session.</p>}
      {selected && back && <Button size="xs" variant="ghost" className="mb-2 -ml-2" onClick={() => { setTrail(previous => previous.slice(0, -1)); setSelected({ type: 'file', id: back }); }}>
        <ArrowLeft className="size-3" />Back to {back.split('/').pop()}
      </Button>}
      {selected && <Suspense fallback={<p role="status" className="text-xs">Opening viewer…</p>}>
        <DocumentViewer
          compact
          title={selected.type === 'file' ? selected.id : sources.find(source => source.id === selected.id)?.title ?? 'Source document'}
          preview={selected.type === 'file' ? preview : { name: selected.id, kind: 'markdown', content: sourcePreview?.content ?? '' }}
          raw={raw}
          rawLabels={['Raw', 'Rendered']}
          onToggleRaw={selected.type === 'file' ? (preview && (preview.kind === 'html' || preview.kind === 'markdown') ? () => setRaw(value => !value) : undefined) : (sourcePreview?.content !== undefined ? () => setRaw(value => !value) : undefined)}
          fileUrl={fileUrl}
          links={links}
          downloadHref={selected.type === 'file' ? `${fileUrl}&download=1` : undefined}
          browserHref={selected.type === 'file' && preview?.kind === 'html' ? `${fileUrl}&open=1` : undefined}
          status={sourcePreview?.content === undefined && sourcePreview?.location
            ? <a className="text-primary underline" href={sourcePreview.location} target="_blank" rel="noopener noreferrer">Open source document</a>
            : error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        />
      </Suspense>}
    </div>
  </section>;
}
