import { describe, expect, it } from 'vitest';
import {
  buildPreviewDocument,
  dependsOnExternalScript,
  isStyleSheetLink,
  LOCKED_FORBID_TAGS,
  previewCsp,
  sanitizeOptions,
  TRUSTED_FORBID_TAGS,
} from './previewPolicy.js';

/**
 * The policy contract. DOM-level effects of these options are asserted against real Chromium in
 * gui/e2e/root-documents.spec.ts; this file pins the decisions themselves so a regression in the
 * rules fails fast under `npm test`.
 */
function attr(tag: string, rel?: string, href?: string) {
  const node = {
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => (name === 'rel' ? rel : name === 'href' ? href : null),
  } as unknown as Element;
  return node;
}

describe('preview CSP', () => {
  it('never allows script in the default locked mode', () => {
    expect(previewCsp(false)).not.toContain('script-src');
  });

  it('keeps default-src none and closes off base and form hijacking in both modes', () => {
    for (const trusted of [false, true]) {
      const csp = previewCsp(trusted);
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
    }
  });

  it('allows remote presentational subresources from any origin in both modes', () => {
    for (const trusted of [false, true]) {
      const csp = previewCsp(trusted);
      expect(csp).toContain('img-src data: https: http:');
      expect(csp).toContain('style-src \'unsafe-inline\' https: http:');
      expect(csp).toContain('font-src data: https: http:');
    }
  });

  it('admits script only for a trusted document', () => {
    expect(previewCsp(true)).toContain('script-src');
    expect(previewCsp(false)).not.toContain('script-src');
  });

  it('never leaks a frame or media capability that the assets policy did not intend', () => {
    for (const trusted of [false, true]) {
      expect(previewCsp(trusted)).not.toContain('frame-src');
      expect(previewCsp(trusted)).not.toContain('connect-src');
    }
  });
});

describe('sanitize options', () => {
  it('forbids script in the locked mode', () => {
    expect(sanitizeOptions(false).FORBID_TAGS).toContain('script');
  });

  it('readmits stylesheet links in both modes, because Q1 covers styles', () => {
    expect(sanitizeOptions(false).ADD_TAGS).toEqual(['link']);
    expect(sanitizeOptions(true).ADD_TAGS).toEqual(['link', 'script']);
  });

  it('admits script only for a trusted document, via ADD_TAGS', () => {
    const trusted = sanitizeOptions(true);
    expect(trusted.FORBID_TAGS).not.toContain('script');
    expect(trusted.ADD_TAGS).toContain('script');
    expect(sanitizeOptions(false).ADD_TAGS).not.toContain('script');
  });

  it('still forbids the embedded-content tags when trusted', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      expect(sanitizeOptions(true).FORBID_TAGS).toContain(tag);
    }
  });

  it('always forbids iframe, object, embed, form, meta and base', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form', 'meta', 'base']) {
      expect(LOCKED_FORBID_TAGS).toContain(tag);
      expect(TRUSTED_FORBID_TAGS).toContain(tag);
    }
  });

  it('keeps inline SVG, which AI output uses for icons and charts', () => {
    expect(sanitizeOptions(false).USE_PROFILES).toMatchObject({ svg: true });
  });

  it('returns fresh arrays so a caller cannot mutate the shared policy', () => {
    const first = sanitizeOptions(false);
    first.FORBID_TAGS.push('style');
    first.ADD_TAGS.push('script');
    expect(sanitizeOptions(false).FORBID_TAGS).not.toContain('style');
    expect(sanitizeOptions(false).ADD_TAGS).not.toContain('script');
  });
});

describe('stylesheet link admission', () => {
  it('admits a remote stylesheet', () => {
    expect(isStyleSheetLink(attr('link', 'stylesheet', 'https://cdn.example/bootstrap.css'))).toBe(true);
    expect(isStyleSheetLink(attr('link', 'stylesheet', '//cdn.example/bootstrap.css'))).toBe(true);
  });

  it('rejects every other link relation and non-remote hrefs', () => {
    expect(isStyleSheetLink(attr('link', 'preload', 'https://cdn.example/app.js'))).toBe(false);
    expect(isStyleSheetLink(attr('link', 'prefetch', 'https://cdn.example/app.js'))).toBe(false);
    expect(isStyleSheetLink(attr('link', 'import', 'https://cdn.example/x.html'))).toBe(false);
    expect(isStyleSheetLink(attr('link', undefined, 'https://cdn.example/app.css'))).toBe(false);
    expect(isStyleSheetLink(attr('link', 'stylesheet', 'data:text/css,body{}'))).toBe(false);
  });
});

describe('external script detection', () => {
  it('spots the Tailwind Play CDN pattern that makes styling script-dependent', () => {
    expect(dependsOnExternalScript('<script src="https://cdn.tailwindcss.com"></script>')).toBe(true);
    expect(dependsOnExternalScript('<script\n  defer\n  src="https://unpkg.com/x.js">')).toBe(true);
  });

  it('ignores documents that do not pull a remote script', () => {
    expect(dependsOnExternalScript('<style>body{color:red}</style>')).toBe(false);
    expect(dependsOnExternalScript('<link rel="stylesheet" href="https://cdn.example/a.css">')).toBe(false);
    expect(dependsOnExternalScript('')).toBe(false);
  });
});

describe('preview document assembly', () => {
  it('declares a charset, which the sanitized body can no longer carry itself', () => {
    expect(buildPreviewDocument({ body: '<p>hi</p>', trusted: false })).toContain('<meta charset="utf-8">');
  });

  it('embeds the matching CSP for each mode', () => {
    const locked = buildPreviewDocument({ body: '<p>hi</p>', trusted: false });
    const trusted = buildPreviewDocument({ body: '<p>hi</p>', trusted: true });
    expect(locked).toContain(previewCsp(false));
    expect(trusted).toContain(previewCsp(true));
    expect(trusted).toContain('script-src');
    expect(locked).not.toContain('script-src');
  });

  it('wraps the body in a complete document', () => {
    const document = buildPreviewDocument({ body: '<h1>ok</h1>', trusted: false });
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain('<body><h1>ok</h1></body>');
  });
});
