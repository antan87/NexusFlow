import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import {
  buildPreviewDocument,
  isStyleSheetHref,
  safeAssetUrl,
  sanitizeOptions,
  type HeadAssets,
} from './previewPolicy.js';

export type DocumentKind = 'markdown' | 'text' | 'html' | 'pdf' | 'image' | 'download';
export interface DocumentPreviewData { name: string; kind: DocumentKind; content?: string }

/**
 * Reads the remote assets the viewer is willing to re-emit, because DOMPurify hands back only the
 * `<body>` and a real AI-generated page keeps its stylesheet and Play CDN in the `<head>`.
 *
 * Only what the owner approved comes back: remote stylesheets always (Q1), remote scripts only for
 * a trusted document (Q5). Inline scripts are never hoisted, so trusting a document does not hand
 * it an inline code path.
 */
function collectHeadAssets(html: string, trusted: boolean): HeadAssets {
  const assets: HeadAssets = { stylesheets: [], scripts: [] };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return assets;
  }
  for (const link of Array.from(doc.querySelectorAll('link'))) {
    if (!isStyleSheetHref(link.getAttribute('href'), link.getAttribute('rel'))) continue;
    const href = safeAssetUrl(link.getAttribute('href'));
    if (href && !assets.stylesheets.includes(href)) assets.stylesheets.push(href);
  }
  if (trusted) {
    for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
      const src = safeAssetUrl(script.getAttribute('src'));
      if (src && !assets.scripts.includes(src)) assets.scripts.push(src);
    }
  }
  return assets;
}

/**
 * `expanded` is set by DocumentViewer when the document fills the app viewport. Every branch that
 * has an intrinsic height has to opt out of its capped height there, otherwise maximizing only
 * rescales a letterboxed frame.
 */
export function DocumentPreview({ preview, fileUrl, raw, expanded = false, trusted = false }: { preview: DocumentPreviewData; fileUrl: string; raw: boolean; expanded?: boolean; trusted?: boolean }) {
  const htmlDocument = useMemo(() => {
    if (preview.kind !== 'html' || raw) return '';
    const source = preview.content ?? '';
    return buildPreviewDocument({
      body: DOMPurify.sanitize(source, sanitizeOptions()),
      assets: collectHeadAssets(source, trusted),
      trusted,
    });
  }, [preview, raw, trusted]);
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
