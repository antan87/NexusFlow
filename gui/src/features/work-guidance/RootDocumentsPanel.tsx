import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, FileText, Lightbulb, ListChecks, Map as MapIcon, RefreshCw, type LucideIcon } from 'lucide-react';
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
  const needle = query.toLowerCase();
  const pinned = CONTEXTSPACE_DOCUMENTS.filter((doc) => documents.some((file) => file.name === doc.name)
    && `${doc.label} ${doc.name} ${doc.purpose}`.toLowerCase().includes(needle));
  const visible = documents.filter((doc) => !PINNED.has(doc.name) && doc.name.toLowerCase().includes(needle));
  const pinnedLabel = CONTEXTSPACE_DOCUMENTS.find((doc) => doc.name === selected)?.label;
  // The knowledge file is read as entries; the toggle shows it as the file it is.
  const [knowledgeAsFile, setKnowledgeAsFile] = useState(false);
  const showKnowledge = selected === 'contextspace-knowledge.md' && preview?.kind === 'markdown' && typeof preview.content === 'string' && !knowledgeAsFile;

  // In the narrow panel beside the chat the list and the open document take turns; with room they sit side by side.
  return <section aria-label="Workspace documents" className="@container space-y-4">
    {/* The panel's title already says Documents, so the heading is for screen readers; the refresh is a quiet icon. */}
    <header className="flex items-center gap-2">
      <div className="min-w-0 flex-1"><h2 className="sr-only">Documents</h2><p className="text-sm text-muted-foreground">What ContextSpace keeps for this work, and the files in the workspace root, including documents your agents made.</p></div>
      <IconButton label="Refresh documents" icon={<RefreshCw />} className="text-muted-foreground" disabled={loading || opening} onClick={() => setRevision((value) => value + 1)} />
    </header>
    {listError && <div role="alert" className="text-sm text-destructive">{listError} <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry documents</Button></div>}
    <div className="grid gap-4 @3xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      {/* The list always stays, so the next document is one click away. Beside the chat, with a document open, it is
          compact: names only, in a short scrolling box above the document. */}
      <aside aria-label="Documents to open" className={cn('rounded-xl border border-border bg-card p-3 space-y-3', selected && 'max-h-60 overflow-y-auto @3xl:max-h-none @3xl:overflow-visible')}>
        <Input aria-label="Filter documents" placeholder="Filter documents…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {pinned.length > 0 && <div className="space-y-1">
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
        {pinned.length > 0 && <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your documents</h3>}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading documents…</p> : !listError && !documents.length ? <p className="text-sm text-muted-foreground">No documents in the workspace root yet. Refresh after a file is created.</p> : !visible.length && <p className="text-sm text-muted-foreground">{query ? 'No matching documents.' : 'None yet besides what ContextSpace keeps.'}</p>}
        <ul className="max-h-[65vh] overflow-y-auto space-y-1">{visible.map((doc) => <li key={doc.name}>
          <button type="button" aria-pressed={selected === doc.name} className={`w-full rounded-lg p-2 text-left text-sm hover:bg-accent ${selected === doc.name ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => choose(doc.name)}>
            <span className="flex gap-2 items-start"><FileText size={15} className="mt-0.5 shrink-0" /><span className="break-all">{doc.name}</span></span>
            <span className={cn('block pl-6 text-xs text-muted-foreground', selected && 'hidden @3xl:block')}>{Math.max(1, Math.ceil(doc.size / 1024))} KB · {new Date(doc.modifiedAt).toLocaleDateString()}</span>
          </button>
        </li>)}</ul>
      </aside>
      <article aria-label="Document preview" className={cn('min-w-0 rounded-xl border border-border bg-card p-4 space-y-4', !selected && 'hidden @3xl:block')}>
        {!selected ? <p className="text-sm text-muted-foreground">Select a document to open it here.</p> : <>
          {back && <Button size="sm" variant="ghost" className="-ml-2" onClick={() => { setTrail((previous) => previous.slice(0, -1)); setSelected(back); }}>
            <ArrowLeft size={14} />Back to {back.split('/').pop()}
          </Button>}
          {showKnowledge ? <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Knowledge</h3>
              <Button size="sm" variant="ghost" onClick={() => setKnowledgeAsFile(true)}>Show the file</Button>
            </div>
            <KnowledgeView markdown={preview.content as string} />
          </div> : <DocumentViewer
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
