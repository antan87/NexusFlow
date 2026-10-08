import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, ExternalLink, Maximize2, Minimize2, ShieldAlert, X } from 'lucide-react';
import { Button, buttonVariants } from '../../components/ui/button.js';
import type { MarkdownDocumentLinks } from '../../components/ChatMarkdown.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { cn } from '../../lib/utils';
import { DocumentPreview, type DocumentPreviewData } from './DocumentPreview.js';
import { dependsOnExternalScript } from './previewPolicy.js';

/** Matches the app's existing overlay idiom (dialog.tsx, PluggableDiffViewer, WorktreeTitleModal). */
const OVERLAY = 'fixed inset-0 z-[100] flex flex-col bg-background';

export interface DocumentViewerProps {
  title: string;
  /** Null while the preview request is in flight; `status` is shown in the body instead. */
  preview: DocumentPreviewData | null;
  status?: ReactNode;
  fileUrl?: string;
  downloadHref?: string;
  /**
   * Link that hands the document to the real browser, where it renders as authored. Separate from
   * `downloadHref` on purpose: downloading and rendering are different trust decisions, and a user
   * who saved the file should not have also granted it browser-level script execution.
   */
  browserHref?: string;
  /** Forwarded to the renderer so markdown documents can follow links to sibling files. */
  links?: MarkdownDocumentLinks;
  raw: boolean;
  /** Omit to hide the raw/rendered toggle, which is what a non-markdown/non-HTML document wants. */
  onToggleRaw?: () => void;
  rawLabels?: [string, string];
  onClose?: () => void;
  compact?: boolean;
  /**
   * Fills its container: one slim header row and a body that scrolls on its own, for a reader that
   * takes the panel's whole height. `leading` goes at the start of that row (navigation, Back).
   */
  fill?: boolean;
  leading?: ReactNode;
  notice?: ReactNode;
  className?: string;
}

/** Trust is per document and never persisted: it lapses as soon as the document is closed. */
function TrustControl({ trusted, onToggle, compact }: { trusted: boolean; onToggle: () => void; compact: boolean }) {
  return <Button
    size={compact ? 'xs' : 'sm'}
    variant={trusted ? 'destructive-outline' : 'outline'}
    aria-pressed={trusted}
    title={trusted ? 'Stop running scripts from this document' : 'Run scripts in this document so its styling can load'}
    onClick={onToggle}
  >
    <ShieldAlert size={compact ? 12 : 14} />
    {trusted ? 'Stop trusting' : 'Trust this document'}
  </Button>;
}

/**
 * Owns the maximize affordance for every document surface. Expanding fills the app viewport inside
 * the app's own borders — `fixed inset-0` portaled to `document.body` above the app shell, never the
 * browser Fullscreen API — so Download, the raw toggle and the trust control all stay reachable, and
 * docked side panels like the chat cannot overlap it.
 */
export function DocumentViewer({ title, preview, status, fileUrl = '', downloadHref, browserHref, links, raw, onToggleRaw, rawLabels = ['Raw text', 'Rendered view'], onClose, compact = false, fill = false, leading, notice, className }: DocumentViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const inlineToggle = useRef<HTMLButtonElement>(null);
  const overlayToggle = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(false);

  // Trust lapses when a different document is opened.
  useEffect(() => {
    setTrusted(false);
    setExpanded(false);
  }, [preview?.name]);

  useEffect(() => {
    if (expanded) {
      wasExpanded.current = true;
      overlayToggle.current?.focus();
      return;
    }
    if (wasExpanded.current) {
      wasExpanded.current = false;
      inlineToggle.current?.focus();
    }
  }, [expanded]);

  // Lock background scrolling while expanded.
  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if (event.key === 'Tab' && overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
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
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const [copiedPath, setCopiedPath] = useState(false);
  const pathToCopy = preview?.name ?? title;
  const handleCopyPath = () => {
    void safeCopyToClipboard(pathToCopy).then((ok) => {
      setCopiedPath(ok);
      if (ok) setTimeout(() => setCopiedPath(false), 1500);
    });
  };

  const buttonSize = compact ? 'xs' : 'sm';
  const scriptBound = useMemo(
    () => preview?.kind === 'html' && !raw && dependsOnExternalScript(preview.content ?? ''),
    [preview, raw],
  );
  const trustControl = preview?.kind === 'html' && !raw
    ? <TrustControl trusted={trusted} onToggle={() => setTrusted(value => !value)} compact={compact} />
    : null;
  const guidance = <>
    {notice}
    {scriptBound && <p role="status" className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', compact ? 'mb-2' : 'mb-3')}>
      <ShieldAlert size={12} className="mt-0.5 shrink-0" />
      {trusted
        ? 'This document can run scripts from the internet, so remote code is running in a sandboxed frame.'
        : 'This page loads styling from an external script, which is blocked. Trust the document to load it.'}
    </p>}
  </>;
  const body = (expandedNow: boolean) => preview
    ? <DocumentPreview preview={preview} fileUrl={fileUrl} raw={raw} expanded={expandedNow} trusted={trusted} links={links} />
    : <>{status}</>;

  const folder = (preview?.name ?? title).includes('/') ? (preview?.name ?? title).slice(0, (preview?.name ?? title).lastIndexOf('/') + 1) : '';
  const iconLink = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground';
  /** The reader's one row: where the document is, then what can be done with it, as quiet icons. */
  const fillChrome = (expandedNow: boolean) => (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
      {leading}
      <h3 className="min-w-0 flex-1 truncate font-normal" title={preview?.name ?? title}>
        {folder && <span className="text-muted-foreground">{folder}</span>}
        <span className="font-medium text-foreground">{title.slice(folder && title.startsWith(folder) ? folder.length : 0)}</span>
      </h3>
      {onToggleRaw && <Button size="xs" variant="ghost" className="shrink-0" onClick={onToggleRaw}>{raw ? rawLabels[1] : rawLabels[0]}</Button>}
      {trustControl}
      <Button size="xs" variant="ghost" className="size-7 shrink-0 p-0" aria-label={copiedPath ? 'Path copied' : `Copy path ${pathToCopy}`} title={copiedPath ? 'Path copied to clipboard' : 'Copy path'} onClick={handleCopyPath}>
        {copiedPath ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </Button>
      {downloadHref && (
        <a className={iconLink} href={downloadHref} download={preview?.name.split('/').pop() ?? title.split('/').pop()} aria-label="Download" title="Download">
          <Download size={13} />
        </a>
      )}
      {browserHref && (
        <a className={iconLink} href={browserHref} target="_blank" rel="noopener noreferrer" aria-label="Open in browser" title="Open in your browser, where the document runs as authored">
          <ExternalLink size={13} />
        </a>
      )}
      <Button ref={expandedNow ? overlayToggle : inlineToggle} size="xs" variant="ghost" className="size-7 shrink-0 p-0" aria-label="Expand document" aria-pressed={expandedNow}
        title={expandedNow ? 'Collapse document' : 'Expand document'} onClick={() => setExpanded(value => !value)}>
        {expandedNow ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </Button>
      {onClose && (
        <Button size="xs" variant="ghost" className="size-7 shrink-0 p-0" aria-label="Close document" title="Close document" onClick={() => { if (expandedNow) setExpanded(false); onClose(); }}>
          <X size={13} />
        </Button>
      )}
    </div>
  );

  const chrome = (expandedNow: boolean) => (
    <>
      <div className={cn('flex flex-wrap items-center justify-between gap-2', compact ? 'mb-2' : 'mb-3')}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={cn('break-all font-semibold', compact ? 'text-xs' : 'text-sm')}>{title}</h3>
          {preview?.kind && (
            <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {preview.kind}
            </span>
          )}
          <Button
            size={compact ? 'xs' : 'sm'}
            variant="ghost"
            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1 shrink-0"
            aria-label={copiedPath ? 'Path copied' : `Copy path ${pathToCopy}`}
            title={copiedPath ? 'Path copied to clipboard' : 'Copy path'}
            onClick={handleCopyPath}
          >
            {copiedPath ? <Check size={compact ? 11 : 13} className="text-emerald-500" /> : <Copy size={compact ? 11 : 13} />}
            <span className="text-[11px] hidden sm:inline">{copiedPath ? 'Copied' : 'Copy path'}</span>
          </Button>
        </div>
        <div className={cn('flex flex-wrap items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
          {onToggleRaw && <Button size={buttonSize} variant="outline" onClick={onToggleRaw}>{raw ? rawLabels[1] : rawLabels[0]}</Button>}
          {trustControl}
          {downloadHref && (
            <a
              className={cn(buttonVariants({ variant: 'outline', size: buttonSize }), 'gap-1.5')}
              href={downloadHref}
              download={preview?.name.split('/').pop() ?? title.split('/').pop()}
            >
              <Download size={compact ? 12 : 14} />
              <span>Download</span>
            </a>
          )}
          {browserHref && (
            <a
              className={cn(buttonVariants({ variant: 'outline', size: buttonSize }), 'gap-1.5')}
              href={browserHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in your browser, where the document runs as authored"
            >
              <ExternalLink size={compact ? 12 : 14} />
              <span>Open in browser</span>
            </a>
          )}
          <Button
            ref={expandedNow ? overlayToggle : inlineToggle}
            size={buttonSize}
            variant="ghost"
            aria-label="Expand document"
            aria-pressed={expandedNow}
            title={expandedNow ? 'Collapse document' : 'Expand document'}
            onClick={() => setExpanded(value => !value)}
          >
            {expandedNow ? <Minimize2 size={compact ? 12 : 14} /> : <Maximize2 size={compact ? 12 : 14} />}
            {expandedNow ? 'Collapse' : 'Expand'}
          </Button>
          {onClose && <Button size={buttonSize} variant="ghost" aria-label="Close document" title="Close document" onClick={() => { if (expandedNow) setExpanded(false); onClose(); }}><X size={compact ? 12 : 14} /></Button>}
        </div>
      </div>
      {guidance}
    </>
  );

  return (
    <>
      {fill ? (
        <div className={cn('flex h-full min-h-0 flex-col', expanded && 'hidden', className)}>
          {fillChrome(false)}
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {guidance}
            {body(false)}
          </div>
        </div>
      ) : (
      <div className={cn(expanded && 'hidden', className)}>
        {chrome(false)}
        <div className={cn('overflow-auto', expanded ? 'h-full' : 'max-h-[70vh]')}>
          {body(false)}
        </div>
      </div>
      )}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          ref={overlayRef}
          className={OVERLAY}
          role="dialog"
          aria-modal="true"
          aria-label={`Expanded ${title}`}
          data-testid="document-viewer-expanded"
        >
          {fill ? (
            <>
              {fillChrome(true)}
              <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 sm:p-4">
                {guidance}
                {body(true)}
              </div>
            </>
          ) : (
          <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
            <div className="shrink-0 border-b border-border/60 pb-2 mb-2">
              {chrome(true)}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {body(true)}
            </div>
          </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
