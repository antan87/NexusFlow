import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderUp,
  Globe,
  Lightbulb,
  ListChecks,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { IconButton } from '../../components/ui/icon-button.js';
import { Input } from '../../components/ui/input.js';
import { apiFetch } from '../../lib/api/client.js';
import { API_BASE } from '../../lib/apiBase.js';
import type { DocumentKind, DocumentPreviewData } from './DocumentPreview.js';
import { DocumentViewer } from './DocumentViewer.js';
import type { MarkdownDocumentLinks } from '../../components/ChatMarkdown.js';
import { KnowledgeView } from '../knowledge/KnowledgeView.js';
import { cn } from '../../lib/utils.js';

/** Matches the app's existing overlay idiom. */
const OVERLAY = 'fixed inset-0 z-[100] flex flex-col bg-background';

/**
 * The files ContextSpace keeps in the workspace, by what they are for rather than their file names, in this order.
 * They are pinned above the developer's own documents so there is one place to read them.
 */
const CONTEXTSPACE_DOCUMENTS: ReadonlyArray<{ name: string; label: string; purpose: string; icon: LucideIcon }> = [
  { name: 'contextspace-knowledge.md', label: 'Knowledge', purpose: 'Decisions and gotchas the assistants learned here', icon: Lightbulb },
  { name: 'contextspace-milestones.md', label: 'Delivery plan', purpose: 'Delivery order, open questions, decisions put off', icon: MapIcon },
  { name: 'AGENTS.md', label: 'Assistant instructions', purpose: 'What every assistant reads first here', icon: Bot },
  { name: 'contextspace-assignment.md', label: 'Current assignment', purpose: 'The goal as the assistants receive it', icon: ListChecks },
  { name: 'contextspace-plan.md', label: 'Generated plan', purpose: 'Milestones and their order, generated', icon: ListChecks },
];
const PINNED = new Set(CONTEXTSPACE_DOCUMENTS.map((doc) => doc.name));

type RootDocument = { name: string; size: number; modifiedAt: string; kind: DocumentKind };
type Preview = DocumentPreviewData;

function DocumentIcon({ kind }: { kind: DocumentKind }) {
  switch (kind) {
    case 'html': return <Globe size={15} className="mt-0.5 shrink-0 text-amber-500" />;
    case 'image': return <FileImage size={15} className="mt-0.5 shrink-0 text-emerald-500" />;
    case 'pdf': return <FileText size={15} className="mt-0.5 shrink-0 text-rose-500" />;
    case 'markdown': return <FileCode size={15} className="mt-0.5 shrink-0 text-sky-500" />;
    default: return <FileText size={15} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
}

export function RootDocumentsPanel({ workspaceId, workspacePath }: { workspaceId: string; workspacePath?: string }) {
  const [documents, setDocuments] = useState<RootDocument[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>('');
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
  const [knowledgeAsFile, setKnowledgeAsFile] = useState(false);
  const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
  const knowledgeOverlayToggle = useRef<HTMLButtonElement>(null);
  const knowledgeInlineToggle = useRef<HTMLButtonElement>(null);
  const knowledgeOverlayRef = useRef<HTMLDivElement>(null);
  const wasKnowledgeExpanded = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWide, setIsWide] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : false));
  const [splitView, setSplitView] = useState<boolean | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsWide(entry.contentRect.width >= 768);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isSplit = splitView ?? isWide;

  const base = `/api/workspace/${encodeURIComponent(workspaceId)}/documents`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListError('');
    const params = new URLSearchParams();
    if (currentFolder) {
      params.set('folder', currentFolder);
    }
    if (query.trim()) {
      params.set('recursive', '1');
    }
    const queryStr = params.toString() ? `?${params.toString()}` : '';
    void apiFetch<{ documents: RootDocument[]; folders?: string[] }>(`${base}${queryStr}`, { signal: controller.signal }).then((result) => {
      setDocuments(result.documents);
      setFolders(result.folders ?? []);
    }).catch((error) => {
      if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'Unable to load documents.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, revision, currentFolder, query]);

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

  useEffect(() => {
    if (knowledgeExpanded) {
      wasKnowledgeExpanded.current = true;
      knowledgeOverlayToggle.current?.focus();
      return;
    }
    if (wasKnowledgeExpanded.current) {
      wasKnowledgeExpanded.current = false;
      knowledgeInlineToggle.current?.focus();
    }
  }, [knowledgeExpanded]);

  useEffect(() => {
    if (!knowledgeExpanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setKnowledgeExpanded(false);
        return;
      }
      if (event.key === 'Tab' && knowledgeOverlayRef.current) {
        const focusable = knowledgeOverlayRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [knowledgeExpanded]);

  const fileUrlFor = useCallback((name: string) => `${API_BASE}${base}/file?name=${encodeURIComponent(name)}`, [base]);
  const fileUrl = selected ? fileUrlFor(selected) : '';
  const choose = useCallback((name: string | null) => {
    setTrail([]);
    if (name === 'contextspace-knowledge.md') setKnowledgeAsFile(false);
    setSelected(name);
    setKnowledgeExpanded(false);
  }, []);

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
  const needle = query.toLowerCase();
  const pinned = CONTEXTSPACE_DOCUMENTS.filter((doc) => documents.some((file) => file.name === doc.name)
    && `${doc.label} ${doc.name} ${doc.purpose}`.toLowerCase().includes(needle));
  const visible = documents.filter((doc) => !PINNED.has(doc.name) && doc.name.toLowerCase().includes(needle));
  const visibleFolders = useMemo(() => {
    return folders.filter((f) => query ? f.toLowerCase().includes(needle) : true);
  }, [folders, query, needle]);
  const pinnedLabel = CONTEXTSPACE_DOCUMENTS.find((doc) => doc.name === selected)?.label;

  const isKnowledge = selected === 'contextspace-knowledge.md' && !knowledgeAsFile;
  const showKnowledge = isKnowledge && preview?.kind === 'markdown' && typeof preview.content === 'string';

  const parentFolder = useMemo(() => {
    if (!currentFolder) return null;
    const lastSlash = currentFolder.lastIndexOf('/');
    return lastSlash > 0 ? currentFolder.slice(0, lastSlash) : '';
  }, [currentFolder]);

  const navigateToFolder = useCallback((folder: string) => {
    setCurrentFolder(folder);
    setQuery('');
  }, []);

  const documentItems = useMemo(() => [
    ...pinned.map((d) => d.name),
    ...visible.map((d) => d.name),
  ], [pinned, visible]);

  const currentIndex = selected ? documentItems.indexOf(selected) : -1;
  const prevDoc = currentIndex > 0 ? documentItems[currentIndex - 1] : null;
  const nextDoc = currentIndex >= 0 && currentIndex < documentItems.length - 1 ? documentItems[currentIndex + 1] : null;

  const onListKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!documentItems.length) return;
    event.preventDefault();
    const currentIndex = selected ? documentItems.indexOf(selected) : -1;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex === -1
      ? (delta > 0 ? 0 : documentItems.length - 1)
      : Math.min(documentItems.length - 1, Math.max(0, currentIndex + delta));
    const nextDoc = documentItems[nextIndex];
    if (nextDoc) {
      if (nextDoc === 'contextspace-knowledge.md') setKnowledgeAsFile(false);
      choose(nextDoc);
    }
  }, [documentItems, selected, choose]);

  const knowledgeHeader = (expandedNow: boolean, toggleRef: React.RefObject<HTMLButtonElement | null>) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
      <h3 className="text-base font-semibold">Knowledge</h3>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => { if (expandedNow) setKnowledgeExpanded(false); setKnowledgeAsFile(true); }}>Show the file</Button>
        <Button
          ref={toggleRef}
          size="sm"
          variant="ghost"
          aria-label="Expand knowledge"
          aria-pressed={expandedNow}
          title={expandedNow ? 'Collapse knowledge' : 'Expand knowledge'}
          onClick={() => setKnowledgeExpanded((v) => !v)}
        >
          {expandedNow ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {expandedNow ? 'Collapse' : 'Expand'}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Close document" title="Close document" onClick={() => { if (expandedNow) setKnowledgeExpanded(false); choose(null); }}><X size={14} /></Button>
      </div>
    </div>
  );

  return <section aria-label="Workspace documents" className="@container space-y-4">
    <header className="flex items-center gap-2">
      <div className="min-w-0 flex-1"><h2 className="sr-only">Documents</h2><p className="text-sm text-muted-foreground">What ContextSpace keeps for this work, and the files in the workspace root, including documents your agents made.</p></div>
      <IconButton label="Refresh documents" icon={<RefreshCw />} className="text-muted-foreground" disabled={loading || opening} onClick={() => setRevision((value) => value + 1)} />
    </header>
    {listError && <div role="alert" className="text-sm text-destructive">{listError} <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry documents</Button></div>}
    <div
      ref={containerRef}
      className={cn(
        'grid gap-4',
        !selected
          ? '@3xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]'
          : isSplit
            ? 'grid-cols-[minmax(200px,280px)_minmax(0,1fr)]'
            : 'grid-cols-1',
      )}
    >
      <aside
        aria-label="Documents to open"
        onKeyDown={onListKeyDown}
        className={cn(
          'rounded-xl border border-border bg-card p-3 space-y-3 min-w-0',
          selected ? (!isSplit ? 'hidden' : 'max-h-[calc(100vh-14rem)] overflow-y-auto') : '',
        )}
      >
        <div className="relative">
          <Input aria-label="Filter documents" placeholder="Filter documents…" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && (
            <button
              type="button"
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {currentFolder && (
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground border border-border/50 overflow-x-auto no-scrollbar">
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
              onClick={() => navigateToFolder('')}
            >
              <Folder size={13} className="text-amber-500" />
              <span>Root</span>
            </button>
            {currentFolder.split('/').map((seg, idx, arr) => {
              const fullSegPath = arr.slice(0, idx + 1).join('/');
              const isLast = idx === arr.length - 1;
              return (
                <span key={fullSegPath} className="flex shrink-0 items-center gap-1 min-w-0">
                  <ChevronRight size={11} className="shrink-0 opacity-40" />
                  {isLast ? (
                    <span className="font-semibold text-foreground truncate max-w-36">{seg}</span>
                  ) : (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline truncate max-w-28"
                      onClick={() => navigateToFolder(fullSegPath)}
                    >
                      {seg}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {currentFolder && query.trim() && (
          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
            <span>Filtering in <span className="font-medium text-foreground">{currentFolder}</span></span>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setCurrentFolder('')}
            >
              Search all
            </button>
          </div>
        )}
        {pinned.length > 0 && !currentFolder && <div className="space-y-1">
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ContextSpace</h3>
          <ul aria-label="ContextSpace documents" className="space-y-1">{pinned.map((doc) => {
            const Icon = doc.icon;
            return <li key={doc.name}>
              <button type="button" aria-pressed={selected === doc.name} title={doc.name} className={`w-full rounded-lg p-2 text-left text-sm hover:bg-accent ${selected === doc.name ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => { setKnowledgeAsFile(false); choose(doc.name); }}>
                <span className="flex gap-2 items-start"><Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" /><span className="font-medium">{doc.label}</span></span>
                <span className={cn('block pl-6 text-xs text-muted-foreground', selected && 'hidden @3xl:block')}>{doc.purpose}</span>
              </button>
            </li>;
          })}</ul>
        </div>}
        {(visibleFolders.length > 0 || currentFolder) && (
          <div className="space-y-1">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</h3>
            <ul aria-label="Workspace folders" className="space-y-1">
              {currentFolder && (
                <li>
                  <button
                    type="button"
                    aria-label="Up to parent directory"
                    className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground group transition-colors"
                    onClick={() => navigateToFolder(parentFolder ?? '')}
                  >
                    <FolderUp size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>.. (Parent folder)</span>
                  </button>
                </li>
              )}
              {visibleFolders.map((folder) => {
                const folderName = currentFolder && folder.startsWith(currentFolder + '/')
                  ? folder.slice(currentFolder.length + 1)
                  : folder;
                return (
                  <li key={folder}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg p-2 text-left text-sm hover:bg-accent group transition-colors"
                      onClick={() => navigateToFolder(folder)}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Folder size={15} className="mt-0.5 shrink-0 text-amber-500 fill-amber-500/20" />
                        <span className="truncate font-medium">{folderName}</span>
                      </span>
                      <ChevronRight size={13} className="shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {visible.length > 0 && (
          <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {currentFolder ? `Documents in ${currentFolder.split('/').pop()}` : 'Your documents'}
          </h3>
        )}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading documents…</p>
        ) : !listError && !documents.length && !folders.length ? (
          <p className="text-sm text-muted-foreground">
            {currentFolder ? 'No documents in this folder yet.' : 'No documents in the workspace root yet. Refresh after a file is created.'}
          </p>
        ) : !visible.length && !visibleFolders.length && (
          <p className="text-sm text-muted-foreground">
            {query ? 'No matching documents.' : (currentFolder ? 'No documents in this folder yet.' : 'None yet besides what ContextSpace keeps.')}
          </p>
        )}
        <ul className="max-h-[65vh] overflow-y-auto space-y-1">{visible.map((doc) => {
          const displayName = currentFolder && doc.name.startsWith(currentFolder + '/')
            ? doc.name.slice(currentFolder.length + 1)
            : doc.name;
          return <li key={doc.name}>
            <button type="button" aria-pressed={selected === doc.name} className={`w-full rounded-lg p-2 text-left text-sm hover:bg-accent ${selected === doc.name ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => choose(doc.name)}>
              <span className="flex gap-2 items-start"><DocumentIcon kind={doc.kind} /><span className="break-all">{displayName}</span></span>
              <span className={cn('block pl-6 text-xs text-muted-foreground', selected && 'hidden @3xl:block')}>
                {doc.name.includes('/') && !currentFolder ? `${doc.name.slice(0, doc.name.lastIndexOf('/'))} · ` : ''}
                {Math.max(1, Math.ceil(doc.size / 1024))} KB · {new Date(doc.modifiedAt).toLocaleDateString()}
              </span>
            </button>
          </li>;
        })}</ul>
      </aside>
      <article aria-label="Document preview" className={cn('min-w-0 rounded-xl border border-border bg-card p-4 space-y-4', !selected && 'hidden @3xl:block')}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <FileText size={32} className="mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground">Select a document to open it here.</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose a file from the list to preview, read, or export.</p>
          </div>
        ) : <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 -mt-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Documents list"
                title="Return to documents list"
                onClick={() => choose(null)}
              >
                <ArrowLeft size={13} />
                <span>All documents</span>
              </Button>
              {selected.includes('/') && (
                <span className="truncate text-xs text-muted-foreground hidden sm:inline">
                  in <span className="font-medium text-foreground">{selected.slice(0, selected.lastIndexOf('/'))}</span>
                </span>
              )}
              {back && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs shrink-0"
                  onClick={() => {
                    setTrail((previous) => previous.slice(0, -1));
                    setSelected(back);
                  }}
                >
                  <ArrowLeft size={13} />
                  <span>Back to {back.split('/').pop()}</span>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Quick-switch navigation */}
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Previous document"
                  title={prevDoc ? `Previous: ${prevDoc}` : 'No previous document'}
                  disabled={!prevDoc}
                  onClick={() => prevDoc && choose(prevDoc)}
                >
                  <ChevronLeft size={13} />
                </Button>
                <select
                  aria-label="Switch document"
                  title="Switch document"
                  value={selected}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next) choose(next);
                  }}
                  className="h-6 max-w-32 sm:max-w-44 md:max-w-60 truncate bg-transparent px-1 text-xs font-medium text-foreground focus-visible:outline-none cursor-pointer"
                >
                  {documentItems.map((name) => {
                    const pinnedDoc = CONTEXTSPACE_DOCUMENTS.find((d) => d.name === name);
                    const label = pinnedDoc ? `${pinnedDoc.label} (${name})` : name;
                    return (
                      <option key={name} value={name} className="bg-popover text-popover-foreground">
                        {label}
                      </option>
                    );
                  })}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Next document"
                  title={nextDoc ? `Next: ${nextDoc}` : 'No next document'}
                  disabled={!nextDoc}
                  onClick={() => nextDoc && choose(nextDoc)}
                >
                  <ChevronRight size={13} />
                </Button>
              </div>

              {/* Split view toggle button */}
              <Button
                size="sm"
                variant={isSplit ? 'secondary' : 'ghost'}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label={isSplit ? 'Full reader' : 'Split view'}
                aria-pressed={isSplit}
                title={isSplit ? 'Collapse to full reader' : 'Split view (side-by-side)'}
                onClick={() => setSplitView(!isSplit)}
              >
                {isSplit ? <BookOpen size={13} /> : <Columns2 size={13} />}
                <span className="hidden sm:inline">{isSplit ? 'Full reader' : 'Split view'}</span>
              </Button>
            </div>
          </div>
          {isKnowledge ? (
            <>
              <div className={cn(knowledgeExpanded && 'hidden', 'space-y-3')}>
                {knowledgeHeader(false, knowledgeInlineToggle)}
                {opening ? (
                  <p role="status" className="text-sm text-muted-foreground">Opening knowledge…</p>
                ) : previewError ? (
                  <p role="alert" className="text-sm text-destructive">{previewError} <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry knowledge</Button></p>
                ) : showKnowledge ? (
                  <KnowledgeView markdown={preview.content as string} />
                ) : null}
              </div>
              {knowledgeExpanded && typeof document !== 'undefined' && createPortal(
                <div
                  ref={knowledgeOverlayRef}
                  className={OVERLAY}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Expanded Knowledge"
                  data-testid="knowledge-expanded"
                >
                  <div className="flex min-h-0 flex-1 flex-col p-4">
                    {knowledgeHeader(true, knowledgeOverlayToggle)}
                    <div className="min-h-0 flex-1 overflow-auto pt-3">
                      <KnowledgeView markdown={preview?.content as string ?? ''} />
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </>
          ) : <DocumentViewer
            title={pinnedLabel ? `${pinnedLabel} (${selected})` : selected}
            preview={preview}
            raw={raw}
            onToggleRaw={preview?.kind === 'markdown' || preview?.kind === 'html' ? () => setRaw((value) => !value) : undefined}
            downloadHref={`${fileUrl}&download=1`}
            browserHref={preview?.kind === 'html' ? `${fileUrl}&open=1` : undefined}
            onClose={() => choose(null)}
            fileUrl={`${fileUrl}&revision=${revision}`}
            links={links}
            status={<>
              {opening && <p role="status" className="text-sm text-muted-foreground">Opening document…</p>}
              {previewError && <p role="alert" className="text-sm text-destructive">{previewError} <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry preview</Button></p>}
            </>}
          />}
        </>}
      </article>
    </div>
  </section>;
}
