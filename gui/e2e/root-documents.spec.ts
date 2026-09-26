import { test, expect } from './fixtures';

function blankPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test.use({ workspacesData: [{ id: 'demo', branchName: 'demo', description: 'Document browser', repos: [], assistants: [], workspacePath: '/ws/demo', createdAt: '2026-09-22T00:00:00.000Z' }] });

test('opens agent-created Markdown, HTML, PDF and Office documents from the root', async ({ page }) => {
  const documents = [
    { name: 'agent findings.md', kind: 'markdown' },
    { name: 'page.html', kind: 'html' },
    { name: 'evidence.pdf', kind: 'pdf' },
    { name: 'brief.docx', kind: 'download' },
  ].map((doc) => ({ ...doc, size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' }));
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name');
    return route.fulfill({ json: { ...documents.find((doc) => doc.name === name), ...(name?.endsWith('.md') ? { content: '# Agent findings\n\nRoot documents open here.' } : {}), ...(name?.endsWith('.html') ? { content: '<h1>Rendered HTML</h1><script>window.unsafe = true</script>' } : {}) } });
  });
  await page.route('**/api/workspace/demo/documents/file?*', (route) => route.fulfill({ contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' }, body: blankPdf() }));
  await page.goto('/#/workspaces/demo/documents');
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /agent findings.md/ }).click();
  await expect(page.getByRole('heading', { name: 'Agent findings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Raw text', exact: true }).click();
  await expect(page.getByText('# Agent findings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /page.html/ }).click();
  const html = page.getByTitle('Preview of page.html');
  await expect(html).toBeVisible();
  await expect.poll(() => html.evaluate((frame: HTMLIFrameElement) => frame.srcdoc)).toContain('Rendered HTML');
  expect(await html.evaluate((frame: HTMLIFrameElement) => frame.srcdoc)).not.toContain('<script>');
  await page.getByRole('button', { name: /evidence.pdf/ }).click();
  await expect(page.getByTitle('Preview of evidence.pdf')).toBeVisible();
  await page.getByRole('button', { name: /brief.docx/ }).click();
  await expect(page.getByText('Preview is unavailable for this format.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', /name=brief.docx&download=1/);
  await page.getByLabel('Filter documents').fill('agent');
  await expect(page.getByRole('button', { name: /evidence.pdf/ })).toHaveCount(0);
  await page.getByLabel('Filter documents').fill('');
  await page.getByRole('button', { name: /agent findings.md/ }).click();
  await page.screenshot({ path: 'test-results/root-documents.png', fullPage: true });
});

test('maximizes a document inside the app borders and restores focus on Escape', async ({ page }) => {
  const documents = [{ name: 'page.html', kind: 'html', size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' }];
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => route.fulfill({
    json: { name: 'page.html', kind: 'html', content: '<h1>Rendered HTML</h1><style>h1{color:rgb(1,2,3)}</style>' },
  }));
  await page.goto('/#/workspaces/demo/documents');
  await page.getByRole('button', { name: /page.html/ }).click();

  const inlineFrame = page.getByTitle('Preview of page.html');
  await expect(inlineFrame).toBeVisible();
  const inlineBox = await inlineFrame.boundingBox();

  // Stable aria-label plus aria-pressed keeps the control assertable in both states.
  const expand = page.getByRole('button', { name: 'Expand document' });
  await expect(expand).toHaveAttribute('aria-pressed', 'false');
  await expand.click();

  const overlay = page.getByTestId('document-viewer-expanded');
  await expect(overlay).toBeVisible();
  const expandedToggle = overlay.getByRole('button', { name: 'Expand document' });
  await expect(expandedToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(expandedToggle).toBeFocused();

  // The frame is no longer the 65vh letterbox.
  const expandedBox = await overlay.getByTitle('Preview of page.html').boundingBox();
  expect(expandedBox!.height).toBeGreaterThan(inlineBox!.height);

  // Download and the raw toggle stay reachable while expanded.
  await expect(overlay.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Raw text', exact: true })).toBeVisible();

  // Never the browser Fullscreen API: the overlay is bounded by the app viewport.
  const viewport = page.viewportSize()!;
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(overlayBox!.height).toBeLessThanOrEqual(viewport.height);
  expect(await overlay.evaluate((node: HTMLElement) => node.ownerDocument.fullscreenElement)).toBeNull();

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand document' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Expand document' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTitle('Preview of page.html')).toBeVisible();
});

const STYLED_PAGE = [
  '<h1>Styled report</h1>',
  '<link rel="stylesheet" href="https://cdn.example.com/bootstrap.min.css">',
  '<link rel="preload" as="script" href="https://cdn.example.com/app.js">',
  '<style>h1 { color: rebeccapurple; }</style>',
  '<svg width="16" height="16"><circle cx="8" cy="8" r="7" /></svg>',
  '<script src="https://cdn.tailwindcss.com"></script>',
  '<script>window.unsafe = true</script>',
  '<img src="https://cdn.example.com/hero.png" onerror="window.unsafe = true" onclick="window.unsafe = true">',
  '<a href="javascript:window.unsafe=true">bad link</a>',
  '<iframe src="https://evil.example.com"></iframe>',
  '<button onclick="window.unsafe=true">handler</button>',
].join('');

async function openStyledPage(page: import('@playwright/test').Page) {
  const documents = [{ name: 'report.html', kind: 'html', size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' }];
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => route.fulfill({
    json: { name: 'report.html', kind: 'html', content: STYLED_PAGE },
  }));
  await page.goto('/#/workspaces/demo/documents');
  await page.getByRole('button', { name: /report.html/ }).click();
  await expect(page.getByTitle('Preview of report.html')).toBeVisible();
  const srcdoc = () => page.getByTitle('Preview of report.html').evaluate((frame: HTMLIFrameElement) => frame.srcdoc);
  return { frame: page.getByTitle('Preview of report.html'), srcdoc };
}

test('keeps presentational markup and strips active content from agent HTML by default', async ({ page }) => {
  const { frame, srcdoc } = await openStyledPage(page);
  const html = await srcdoc();

  // Styling survives: external stylesheet, inline <style>, inline SVG.
  expect(html).toContain('<link rel="stylesheet" href="https://cdn.example.com/bootstrap.min.css">');
  expect(html).toContain('color: rebeccapurple');
  expect(html).toContain('<svg');
  expect(html).toContain('<circle');

  // Everything that can execute or embed is gone.
  expect(html).not.toContain('<script');
  expect(html).not.toContain('cdn.tailwindcss.com');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('evil.example.com');
  expect(html).not.toContain('onclick');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('rel="preload"');
  expect(html).not.toContain('app.js');

  // Locked by default, and declares a charset now that the document cannot carry its own.
  expect(await frame.getAttribute('sandbox')).toBe('');
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('style-src \'unsafe-inline\' https: http:');
  expect(html).not.toContain('script-src');

  // A page whose styling needs a script explains itself rather than looking broken.
  await expect(page.getByText('This page loads styling from an external script, which is blocked.', { exact: false })).toBeVisible();
});

test('runs a trusted document in an opaque-origin frame', async ({ page }) => {
  const { frame, srcdoc } = await openStyledPage(page);

  await page.getByRole('button', { name: 'Trust this document', exact: true }).click();
  const trusted = await srcdoc();
  expect(trusted).toContain('https://cdn.tailwindcss.com');
  expect(trusted).toContain('script-src');
  // Scripts are allowed but the frame is never given the app's origin, and other escapes stay shut.
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(trusted).not.toContain('<iframe');
  expect(trusted).not.toContain('onclick');
  expect(trusted).not.toContain('javascript:');
  expect(trusted).toContain("default-src 'none'");
  await expect(page.getByText('remote code is running in a sandboxed frame', { exact: false })).toBeVisible();
});

test('rejects a second document that tries to inherit trust', async ({ page }) => {
  const documents = [
    { name: 'report.html', kind: 'html', size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' },
    { name: 'other.html', kind: 'html', size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' },
  ];
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name');
    return route.fulfill({ json: { name, kind: 'html', content: STYLED_PAGE } });
  });
  await page.goto('/#/workspaces/demo/documents');
  await page.getByRole('button', { name: /report.html/ }).click();
  await expect(page.getByTitle('Preview of report.html')).toBeVisible();
  await page.getByRole('button', { name: 'Trust this document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop trusting', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /other.html/ }).click();
  await expect(page.getByTitle('Preview of other.html')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trust this document', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop trusting', exact: true })).toHaveCount(0);
  expect(await page.getByTitle('Preview of other.html').evaluate((node: HTMLIFrameElement) => node.srcdoc)).not.toContain('script-src');
});

test('recovers from list and preview failures and discovers newly created files on refresh', async ({ page }) => {
  let listFails = true;
  let previewFails = true;
  const documents: Array<{ name: string; kind: string; size: number; modifiedAt: string }> = [];
  await page.route('**/api/workspace/demo/documents', (route) => listFails
    ? route.fulfill({ status: 400, json: { error: 'Workspace is unavailable.' } })
    : route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => previewFails
    ? route.fulfill({ status: 400, json: { error: 'Document was removed.' } })
    : route.fulfill({ json: { name: 'report.txt', kind: 'text', content: 'Recovered report' } }));
  await page.goto('/#/workspaces/demo/documents');
  await expect(page.getByRole('alert')).toContainText('Workspace is unavailable');
  listFails = false;
  await page.getByRole('button', { name: 'Retry documents' }).click();
  await expect(page.getByText('No documents in the workspace root yet.', { exact: false })).toBeVisible();
  documents.push({ name: 'report.txt', kind: 'text', size: 20, modifiedAt: '2026-09-22T00:00:00.000Z' });
  await page.getByRole('button', { name: 'Refresh documents' }).click();
  await page.getByRole('button', { name: /report.txt/ }).click();
  await expect(page.getByRole('alert')).toContainText('Document was removed');
  previewFails = false;
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.getByText('Recovered report')).toBeVisible();
});
