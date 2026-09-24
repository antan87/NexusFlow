import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Button } from '../../components/ui/button.js';

// Keep the worker version paired with the PDF.js version used by React-PDF.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export type DocumentKind = 'markdown' | 'text' | 'html' | 'pdf' | 'image' | 'download';
export interface DocumentPreviewData { name: string; kind: DocumentKind; content?: string }

function PdfPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, element.clientWidth - 24)));
    observer.observe(element);
    setWidth(Math.max(200, element.clientWidth - 24));
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setPage(1); setPages(0); setError(''); }, [url]);

  return <div ref={host} className="min-w-0">
    {pages > 1 && <div className="mb-2 flex items-center justify-center gap-2 text-xs">
      <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button size="xs" variant="outline" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Document file={url} loading={<p role="status" className="text-sm">Opening PDF…</p>}
      error={<p role="alert" className="text-sm text-destructive">The PDF could not be displayed. Download it to open in another viewer.</p>}
      onLoadSuccess={({ numPages }) => { setPages(numPages); setPage(value => Math.min(value, numPages)); setError(''); }}
      onLoadError={(reason) => setError(reason.message)}>
      <Page pageNumber={page} width={width} renderAnnotationLayer={false} loading={<p role="status" className="text-sm">Rendering page…</p>} />
    </Document>
  </div>;
}

export function DocumentPreview({ preview, fileUrl, raw }: { preview: DocumentPreviewData; fileUrl: string; raw: boolean }) {
  const safeHtml = useMemo(() => preview.kind === 'html' && !raw
    ? DOMPurify.sanitize(preview.content ?? '', { USE_PROFILES: { html: true }, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'] })
    : '', [preview, raw]);
  const htmlDocument = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"></head><body>${safeHtml}</body></html>`;

  if (preview.kind === 'markdown' && !raw) return <ChatMarkdown content={preview.content ?? ''} />;
  if (preview.kind === 'html' && !raw) return <iframe title={`Preview of ${preview.name}`} sandbox="" referrerPolicy="no-referrer" srcDoc={htmlDocument} className="h-[65vh] w-full rounded border border-border bg-white" />;
  if (preview.content !== undefined) return <pre className="whitespace-pre-wrap break-words text-sm">{preview.content}</pre>;
  if (preview.kind === 'pdf') return <PdfPreview url={fileUrl} />;
  if (preview.kind === 'image') return <img src={fileUrl} alt={preview.name} className="max-w-full h-auto" />;
  return <p className="text-sm text-muted-foreground">Preview is unavailable for this format. Download the document to open it in its application.</p>;
}
