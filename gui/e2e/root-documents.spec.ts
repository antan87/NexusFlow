import { test, expect } from './fixtures';

test.use({ workspacesData: [{ id: 'demo', branchName: 'demo', description: 'Document browser', repos: [], assistants: [], workspacePath: '/ws/demo', createdAt: '2026-09-22T00:00:00.000Z' }] });

test('opens agent-created Markdown, raw text, PDF and Office documents from the root', async ({ page }) => {
  const documents = [
    { name: 'agent findings.md', kind: 'markdown' },
    { name: 'evidence.pdf', kind: 'pdf' },
    { name: 'brief.docx', kind: 'download' },
  ].map((doc) => ({ ...doc, size: 120, modifiedAt: '2026-09-22T00:00:00.000Z' }));
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents } }));
  await page.route('**/api/workspace/demo/documents/preview?*', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name');
    return route.fulfill({ json: { ...documents.find((doc) => doc.name === name), ...(name?.endsWith('.md') ? { content: '# Agent findings\n\nRoot documents open here.' } : {}) } });
  });
  await page.route('**/api/workspace/demo/documents/file?*', (route) => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\nfixture' }));
  await page.goto('/#/workspaces/demo/documents');
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /agent findings.md/ }).click();
  await expect(page.getByRole('heading', { name: 'Agent findings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Raw text', exact: true }).click();
  await expect(page.getByText('# Agent findings', { exact: false })).toBeVisible();
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
