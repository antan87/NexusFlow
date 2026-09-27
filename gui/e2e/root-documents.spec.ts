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
    return route.fulfill({ json: { ...documents.find((doc) => doc.name === name), ...(name?.endsWith('.md') ? { content: '# Agent findings\n\nRoot documents open here.' } : {}), ...(name?.endsWith('.html') ? { content: '<!doctype html><html><head><style>h1 { color: rgb(18, 52, 86); }</style></head><body><h1>Rendered HTML</h1><script>window.unsafe = true</script></body></html>' } : {}) } });
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
  await expect(page.frameLocator('iframe[title="Preview of page.html"]').getByRole('heading', { name: 'Rendered HTML' })).toHaveCSS('color', 'rgb(18, 52, 86)');
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

test('links inside a document never leave the app', async ({ page }) => {
  const index = [
    '# Screenshot index',
    '',
    '- [Jump to limits](#evidence-limits)',
    '- [01 onboarding](/ws/demo/assessment/screenshots/01-onboarding.png)',
    '- [Relative notes](notes/day%201.md)',
    '- [Other workspace](/home/me/workspaces/other/shot.png)',
    '- [W3C labels](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)',
    '- [Script](javascript:window.unsafe=true)',
    '',
    '![inline capture](assessment/screenshots/01-onboarding.png)',
    '',
    ...Array.from({ length: 60 }, (_, line) => `Filler line ${line}.`),
    '',
    '## Evidence limits',
    '',
    'Screenshots alone do not establish conformance.',
  ].join('\n');
  const previews: Record<string, object> = {
    'index.md': { name: 'index.md', kind: 'markdown', content: index },
    'assessment/screenshots/01-onboarding.png': { name: 'assessment/screenshots/01-onboarding.png', kind: 'image' },
    'notes/day 1.md': { name: 'notes/day 1.md', kind: 'markdown', content: '# Day one notes\n\n[Back up](../index.md)' },
  };
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents: [{ name: 'index.md', kind: 'markdown', size: 400, modifiedAt: '2026-09-22T00:00:00.000Z' }] } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => {
    const preview = previews[new URL(route.request().url()).searchParams.get('name') ?? ''];
    return preview ? route.fulfill({ json: preview }) : route.fulfill({ status: 400, json: { error: 'Not found.' } });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/api/workspace/demo/documents/file?*', (route) => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: png }));

  await page.goto('/#/workspaces/demo/documents');
  const appUrl = () => new URL(page.url());
  await page.getByRole('button', { name: /index.md/ }).click();
  const preview = page.getByRole('article', { name: 'Document preview' });
  await expect(preview.getByRole('heading', { name: 'Screenshot index' })).toBeVisible();
  await expect(preview.getByRole('img', { name: 'inline capture' })).toHaveAttribute('src', /name=assessment%2Fscreenshots%2F01-onboarding.png/);

  // An in-document anchor scrolls instead of changing the hash route.
  await preview.getByRole('link', { name: 'Jump to limits' }).click();
  await expect(preview.getByRole('heading', { name: 'Evidence limits' })).toBeInViewport();
  expect(appUrl().hash).toBe('#/workspaces/demo/documents');

  // An absolute path inside the workspace opens in the viewer, with a way back.
  await preview.getByRole('link', { name: '01 onboarding' }).click();
  await expect(preview.getByRole('img', { name: 'assessment/screenshots/01-onboarding.png' })).toBeVisible();
  expect(appUrl().pathname).toBe('/');
  await preview.getByRole('button', { name: 'Back to index.md' }).click();

  // A relative link resolves against the document and chains back up.
  await preview.getByRole('link', { name: 'Relative notes' }).click();
  await expect(preview.getByRole('heading', { name: 'Day one notes' })).toBeVisible();
  await preview.getByRole('link', { name: 'Back up' }).click();
  await expect(preview.getByRole('heading', { name: 'Screenshot index' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Back to day 1.md' })).toBeVisible();

  // A path outside the workspace and an unsafe scheme are inert, with the path copyable.
  await expect(preview.getByRole('link', { name: 'Other workspace' })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: 'Copy path /home/me/workspaces/other/shot.png' })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Script' })).toHaveCount(0);

  // A web link opens outside the app window.
  const external = preview.getByRole('link', { name: /W3C labels/ });
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', /noopener/);
  expect(appUrl().pathname).toBe('/');
  expect(await page.evaluate(() => (window as unknown as { unsafe?: boolean }).unsafe)).toBeUndefined();
});
