import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, Maximize2, Minimize2, ShieldAlert, X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import type { MarkdownDocumentLinks } from '../../components/ChatMarkdown.js';
import { cn } from '../../lib/utils';
import { DocumentPreview, type DocumentPreviewData } from './DocumentPreview.js';
import { dependsOnExternalScript } from './previewPolicy.js';

/** Matches the app's existing overlay idiom (dialog.tsx, PluggableDiffViewer, WorktreeTitleModal). */
const OVERLAY = 'fixed inset-0 z-50 flex flex-col bg-background';

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
 * the app's own borders — `fixed inset-0` within the app shell, never the browser Fullscreen API —
 * so Download, the raw toggle and the trust control all stay reachable.
 */
export function DocumentViewer({ title, preview, status, fileUrl = '', downloadHref, browserHref, links, raw, onToggleRaw, rawLabels = ['Raw text', 'Rendered view'], onClose, compact = false, notice, className }: DocumentViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const inlineToggle = useRef<HTMLButtonElement>(null);
  const overlayToggle = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);

  // Trust lapses when a different document is opened.
  useEffect(() => { setTrusted(false); }, [preview?.name]);

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

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

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

  const chrome = (expandedNow: boolean, toggleRef: React.RefObject<HTMLButtonElement | null>) => (
    <>
      <div className={cn('flex flex-wrap items-center justify-between gap-2', compact ? 'mb-2' : 'mb-3')}>
        <h3 className={cn('break-all font-semibold', compact ? 'text-xs' : 'text-sm')}>{title}</h3>
        <div className={cn('flex items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
          {onToggleRaw && <Button size={buttonSize} variant="outline" onClick={onToggleRaw}>{raw ? rawLabels[1] : rawLabels[0]}</Button>}
          {trustControl}
          {downloadHref && <a className="text-primary underline" href={downloadHref} download={preview?.name.split('/').pop() ?? title.split('/').pop()}><Download size={compact ? 12 : 14} className="mr-1 inline" />Download</a>}
          {browserHref && <a
            className="text-primary underline"
            href={browserHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in your browser, where the document runs as authored"
          ><ExternalLink size={compact ? 12 : 14} className="mr-1 inline" />Open in browser</a>}
          <Button
            ref={toggleRef}
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
          {onClose && <Button size={buttonSize} variant="ghost" aria-label="Close document" title="Close document" onClick={onClose}><X size={compact ? 12 : 14} /></Button>}
        </div>
      </div>
      {guidance}
    </>
  );

  return (
    <>
      <div className={cn(expanded && 'hidden', className)}>
        {chrome(false, inlineToggle)}
        <div className={cn('overflow-auto', expanded ? 'h-full' : 'max-h-[70vh]')}>
          {body(false)}
        </div>
      </div>
      {expanded && (
        <div className={OVERLAY} role="dialog" aria-label={`Expanded ${title}`} data-testid="document-viewer-expanded">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {chrome(true, overlayToggle)}
            <div className="min-h-0 flex-1 overflow-auto">
              {body(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
