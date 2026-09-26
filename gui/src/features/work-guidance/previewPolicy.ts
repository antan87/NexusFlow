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

/** Q5: only reachable when the user trusts one specific document. */
const TRUSTED_SCRIPT = "script-src 'unsafe-inline' 'unsafe-eval' https: http:";

export function previewCsp(trusted: boolean): string {
  return trusted ? `${BASE}; ${ASSETS}; ${TRUSTED_SCRIPT}` : `${BASE}; ${ASSETS}`;
}

/**
 * Mirrors the two owner decisions. `USE_PROFILES` rewrites the allowlist outright and, verified in
 * Chromium, drops `script` and `link` in both modes; `ADD_TAGS` is the only way to readmit them.
 *
 * - Q1 (any origin) covers stylesheets, so `link` is readmitted in both modes. A hook narrows it to
 *   remote `rel="stylesheet"` only, so preload/prefetch/import still cannot through.
 * - Q5 (script needs trust) is why `script` appears only in the trusted set.
 */
export const SANITIZE_BASE = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'meta', 'base'],
} as const;

export const LOCKED_ADD_TAGS = ['link'] as const;
export const TRUSTED_ADD_TAGS = ['link', 'script'] as const;

export const LOCKED_FORBID_TAGS = [...SANITIZE_BASE.FORBID_TAGS, 'script'] as const;
export const TRUSTED_FORBID_TAGS = SANITIZE_BASE.FORBID_TAGS as readonly string[];

export function sanitizeOptions(trusted: boolean) {
  return {
    USE_PROFILES: { ...SANITIZE_BASE.USE_PROFILES },
    FORBID_TAGS: trusted ? [...TRUSTED_FORBID_TAGS] : [...LOCKED_FORBID_TAGS],
    ADD_TAGS: trusted ? [...TRUSTED_ADD_TAGS] : [...LOCKED_ADD_TAGS],
  };
}

/**
 * `<link>` is only useful for stylesheets here, and `rel` decides that. Anything else (preload,
 * prefetch, import) is dropped rather than allowed wholesale.
 */
export function isStyleSheetLink(node: Element): boolean {
  return (node.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')
    && /^(https?:)?\/\//i.test(node.getAttribute('href') ?? '');
}

export interface PreviewDocumentOptions {
  /** Sanitized body HTML for the document. */
  body: string;
  trusted: boolean;
}

export function buildPreviewDocument({ body, trusted }: PreviewDocumentOptions): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp(trusted)}"></head><body>${body}</body></html>`;
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
