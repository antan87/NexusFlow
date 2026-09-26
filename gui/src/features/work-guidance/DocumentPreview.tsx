import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';

export type DocumentKind = 'markdown' | 'text' | 'html' | 'pdf' | 'image' | 'download';
export interface DocumentPreviewData { name: string; kind: DocumentKind; content?: string }

/**
 * `expanded` is set by DocumentViewer when the document fills the app viewport. Every branch that
 * has an intrinsic height has to opt out of its capped height there, otherwise maximizing only
 * rescales a letterboxed frame.
 */
export function DocumentPreview({ preview, fileUrl, raw, expanded = false }: { preview: DocumentPreviewData; fileUrl: string; raw: boolean; expanded?: boolean }) {
  const safeHtml = useMemo(() => preview.kind === 'html' && !raw
    ? DOMPurify.sanitize(preview.content ?? '', { USE_PROFILES: { html: true }, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'] })
    : '', [preview, raw]);
  const htmlDocument = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"></head><body>${safeHtml}</body></html>`;
  const height = expanded ? 'h-full' : 'h-[65vh]';

  if (preview.kind === 'markdown' && !raw) return <ChatMarkdown content={preview.content ?? ''} />;
  if (preview.kind === 'html' && !raw) return <iframe title={`Preview of ${preview.name}`} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlDocument} className={`${height} w-full rounded border border-border bg-white`} />;
  if (preview.content !== undefined) return <pre className="whitespace-pre-wrap break-words text-sm">{preview.content}</pre>;
  if (preview.kind === 'pdf') return <iframe title={`Preview of ${preview.name}`} src={fileUrl} className={`${height} w-full rounded border border-border`} />;
  if (preview.kind === 'image') return <img src={fileUrl} alt={preview.name} className={expanded ? 'mx-auto h-full w-auto max-w-full object-contain' : 'max-w-full h-auto'} />;
  return <p className="text-sm text-muted-foreground">Preview is unavailable for this format. Download the document to open it in its application.</p>;
}
