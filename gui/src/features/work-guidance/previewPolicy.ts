/**
 * Policy for rendering agent-created HTML in the document viewer.
 *
 * The viewer renders untrusted, AI-authored HTML, so the default is locked: no script, opaque
 * origin, and remote subresources limited to presentational types. A document can be explicitly
 * trusted by the user, which is the only path that lets the Play CDN style a page.
 *
 * Kept free of DOM access so the policy is unit-testable without a browser; the DOM-level effects
 * are asserted in gui/e2e/root-documents.spec.ts against real Chromium.
 */

/** Applies to both modes. `base-uri`/`form-action` close off base-tag and form hijacking. */
const BASE = "default-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Q1: any origin, for presentational subresources only. Safe by construction in locked mode because
 * no script runs, so the residual channel is CSS-only and the frame is an opaque origin that holds
 * none of the app's data.
 */
const ASSETS = "img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:";

/**
 * Q5: only reachable when the user trusts one specific document.
 *
 * `connect-src` is not optional here. Tailwind's Play CDN initializes, then fetches its engine over
 * `fetch()`, so without it the script runs and still generates no CSS. Verified in Chromium: with
 * `connect-src` missing, `window.tailwind` exists and the page stays unstyled.
 */
const TRUSTED_SCRIPT = "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: http:; connect-src https: http:; worker-src blob:";

export function previewCsp(trusted: boolean): string {
  return trusted ? `${BASE}; ${ASSETS}; ${TRUSTED_SCRIPT}` : `${BASE}; ${ASSETS}`;
}

/**
 * `script` and `link` are forbidden in *both* modes on purpose.
 *
 * DOMPurify returns only the sanitized `<body>`, so anything a real document puts in its `<head>`
 * is discarded before sanitization runs. Rather than fight that, the viewer reads the assets it
 * wants out of the source itself and re-emits them into the `<head>` it builds. That keeps a
 * document's own head markup out of the sanitizer entirely and means the only head content is
 * markup this module authored.
 */
/** Mutable shape, so the result can be handed straight to DOMPurify's `Config`. */
export interface SanitizeConfig {
  USE_PROFILES: { html: boolean; svg: boolean };
  FORBID_TAGS: string[];
}

export const SANITIZE_OPTIONS: SanitizeConfig = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ['script', 'link', 'iframe', 'object', 'embed', 'form', 'meta', 'base'],
};

export function sanitizeOptions(): SanitizeConfig {
  return {
    USE_PROFILES: { ...SANITIZE_OPTIONS.USE_PROFILES },
    FORBID_TAGS: [...SANITIZE_OPTIONS.FORBID_TAGS],
  };
}

/**
 * Absolute http(s) only. Relative and protocol-relative URLs are rejected because the document is
 * rendered from a `srcDoc` frame with no meaningful base, and every scheme other than http(s)
 * (javascript:, data:, blob:, file:) is refused.
 */
export function safeAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

/** `rel` decides whether a link is presentational, and only a remote stylesheet qualifies. */
export function isStyleSheetHref(href: string | null | undefined, rel: string | null | undefined): boolean {
  return (rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet') && safeAssetUrl(href) !== null;
}

export interface HeadAssets {
  /** Remote stylesheets, hoisted from the source document. */
  stylesheets: string[];
  /** Remote scripts, hoisted only when the document is trusted. */
  scripts: string[];
}

export interface PreviewDocumentOptions {
  /** Sanitized body HTML for the document. */
  body: string;
  trusted: boolean;
  assets?: HeadAssets;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Hoisted scripts go in the <head>, before the body, which is where an authored page puts the Play
 * CDN. Tailwind's CDN injects its generated stylesheet with `document.write`, and that only lands
 * when the script is parser-blocking during parsing; emitted after the body it silently styles
 * nothing. Verified in Chromium: end-of-body placement yields zero generated CSS, head placement
 * yields a full stylesheet.
 */
export function buildPreviewDocument({ body, trusted, assets }: PreviewDocumentOptions): string {
  const stylesheets = (assets?.stylesheets ?? []).map(href => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join('');
  const scripts = (trusted ? assets?.scripts ?? [] : []).map(src => `<script src="${escapeAttribute(src)}"></script>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp(trusted)}">${stylesheets}${scripts}</head><body>${body}</body></html>`;
}

const EXTERNAL_SCRIPT = /<script\b[^>]*\bsrc\s*=/i;

/**
 * Detects pages whose styling depends on a script we are not running, so the viewer can explain
 * itself instead of silently rendering an unstyled document. The dominant case is Tailwind's Play
 * CDN, which generates CSS at runtime and has no stylesheet equivalent.
 */
export function dependsOnExternalScript(html: string): boolean {
  return EXTERNAL_SCRIPT.test(html);
}
