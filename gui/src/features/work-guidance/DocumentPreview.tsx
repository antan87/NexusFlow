import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';

export type DocumentKind = 'markdown' | 'text' | 'html' | 'pdf' | 'image' | 'download';
export interface DocumentPreviewData { name: string; kind: DocumentKind; content?: string }

export function DocumentPreview({ preview, fileUrl, raw }: { preview: DocumentPreviewData; fileUrl: string; raw: boolean }) {
  const safeHtml = useMemo(() => preview.kind === 'html' && !raw
    ? DOMPurify.sanitize(preview.content ?? '', { USE_PROFILES: { html: true }, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'] })
    : '', [preview, raw]);
  const htmlDocument = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"></head><body>${safeHtml}</body></html>`;

  if (preview.kind === 'markdown' && !raw) return <ChatMarkdown content={preview.content ?? ''} />;
  if (preview.kind === 'html' && !raw) return <iframe title={`Preview of ${preview.name}`} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlDocument} className="h-[65vh] w-full rounded border border-border bg-white" />;
  if (preview.content !== undefined) return <pre className="whitespace-pre-wrap break-words text-sm">{preview.content}</pre>;
  if (preview.kind === 'pdf') return <iframe title={`Preview of ${preview.name}`} src={fileUrl} className="h-[65vh] w-full rounded border border-border" />;
  if (preview.kind === 'image') return <img src={fileUrl} alt={preview.name} className="max-w-full h-auto" />;
  return <p className="text-sm text-muted-foreground">Preview is unavailable for this format. Download the document to open it in its application.</p>;
}
