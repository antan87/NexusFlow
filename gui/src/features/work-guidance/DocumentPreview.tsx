import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { buildPreviewDocument, isStyleSheetLink, sanitizeOptions, type PreviewDocumentOptions } from './previewPolicy.js';

export type DocumentKind = 'markdown' | 'text' | 'html' | 'pdf' | 'image' | 'download';
export interface DocumentPreviewData { name: string; kind: DocumentKind; content?: string }

/**
 * Runs DOMPurify with the viewer's policy. `link` is stripped in both modes and only reinstated
 * when it is a remote stylesheet, which keeps preload/prefetch/import out of the document.
 */
function sanitizeDocumentHtml({ body, trusted }: PreviewDocumentOptions): string {
  const keepStyleSheets = (node: Element) => {
    if (node.tagName === 'LINK' && !isStyleSheetLink(node)) node.remove();
  };
  DOMPurify.addHook('afterSanitizeAttributes', keepStyleSheets);
  try {
    return DOMPurify.sanitize(body, sanitizeOptions(trusted));
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

/**
 * `expanded` is set by DocumentViewer when the document fills the app viewport. Every branch that
 * has an intrinsic height has to opt out of its capped height there, otherwise maximizing only
 * rescales a letterboxed frame.
 */
export function DocumentPreview({ preview, fileUrl, raw, expanded = false, trusted = false }: { preview: DocumentPreviewData; fileUrl: string; raw: boolean; expanded?: boolean; trusted?: boolean }) {
  const htmlDocument = useMemo(() => preview.kind === 'html' && !raw
    ? buildPreviewDocument({ body: sanitizeDocumentHtml({ body: preview.content ?? '', trusted }), trusted })
    : '', [preview, raw, trusted]);
  const height = expanded ? 'h-full' : 'h-[65vh]';

  // Only the trusted path may run script, and it must never be sandboxed into the app's origin.
  const sandbox = trusted ? 'allow-scripts' : '';

  if (preview.kind === 'markdown' && !raw) return <ChatMarkdown content={preview.content ?? ''} />;
  if (preview.kind === 'html' && !raw) return <iframe title={`Preview of ${preview.name}`} sandbox={sandbox} referrerPolicy="no-referrer" srcDoc={htmlDocument} className={`${height} w-full rounded border border-border bg-white`} />;
  if (preview.content !== undefined) return <pre className="whitespace-pre-wrap break-words text-sm">{preview.content}</pre>;
  if (preview.kind === 'pdf') return <iframe title={`Preview of ${preview.name}`} src={fileUrl} className={`${height} w-full rounded border border-border`} />;
  if (preview.kind === 'image') return <img src={fileUrl} alt={preview.name} className={expanded ? 'mx-auto h-full w-auto max-w-full object-contain' : 'max-w-full h-auto'} />;
  return <p className="text-sm text-muted-foreground">Preview is unavailable for this format. Download the document to open it in its application.</p>;
}
