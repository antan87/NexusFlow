import { test, expect } from './fixtures';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { dataRoutes } from '../../src/diagnostics/routes';

let root: string;
let previousHome: string | undefined;
const canary = 'private-repository-secret-123456';
test.use({ workspacesData: [{ id: 'private-workspace', branchName: 'private-workspace', repos: [], description: 'Fixture' }] });

test.beforeEach(async ({ page }) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-data-gui-'));
  previousHome = process.env.CONTEXTSPACE_HOME;
  process.env.CONTEXTSPACE_HOME = root;
  await fs.mkdir(path.join(root, canary));
  await fs.writeFile(path.join(root, 'contextspace.json'), JSON.stringify({
    id: 'private-workspace', branchName: canary, description: canary, workspacePath: root,
    mode: 'in-place', repos: [path.join(root, canary)],
  }));
  const backend = dataRoutes(async id => { if (id !== 'private-workspace') throw new Error(); return root; });
  // Exercise real core/HTTP behavior with a disposable profile, while unrelated app APIs use fixtures.
  for (const pattern of ['**/api/data-guide**', '**/api/diagnostics/**']) {
    await page.route(pattern, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await backend.request(url.pathname.replace(/^\/api/, ''), {
        method: request.method(), headers: { 'Content-Type': 'application/json' },
        ...(request.method() === 'POST' ? { body: request.postData() ?? '{}' } : {}),
      });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
  }
});
test.afterEach(async () => {
  if (previousHome === undefined) delete process.env.CONTEXTSPACE_HOME; else process.env.CONTEXTSPACE_HOME = previousHome;
  await fs.rm(root, { recursive: true, force: true });
});

test('shows ownership and deletion boundaries without checking tool registries', async ({ page }, testInfo) => {
  let toolChecks = 0;
  await page.route('**/api/updates/tools**', async route => { toolChecks++; await route.fulfill({ json: [] }); });
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Data and privacy', exact: true })).toBeVisible();
  await page.getByText('ContextSpace chat and approvals', { exact: true }).click();
  await expect(page.getByText('Workspace deletion does not clear the global chat store.', { exact: false })).toBeVisible();
  expect(toolChecks).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('data-guide.png'), fullPage: true });
  await page.getByRole('button', { name: 'Check Now' }).click();
  await expect.poll(() => toolChecks).toBe(1);
});

test('removes sections from a captured report and downloads exactly the reviewed bytes', async ({ page }, testInfo) => {
  let collections = 0;
  page.on('request', request => { if (request.url().endsWith('/api/diagnostics/preview')) collections++; });
  await page.goto('/#/settings');
  await page.getByLabel('Report scope').selectOption('private-workspace');
  await page.getByRole('button', { name: 'Preview diagnostics' }).click();
  const preview = page.getByLabel('Diagnostic file preview');
  await expect(preview).toContainText('repository-1');
  expect(await preview.textContent()).not.toContain(canary);
  expect(await preview.textContent()).not.toContain(root);
  await fs.rm(path.join(root, canary), { recursive: true });
  const runtime = page.getByRole('checkbox', { name: 'Runtime versions and platform' });
  await runtime.focus(); await page.keyboard.press('Space');
  await expect(runtime).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Download reviewed report' })).toBeEnabled();
  const captured = (await preview.textContent())!;
  expect(JSON.parse(captured).sections.runtime).toBeUndefined();
  expect(JSON.parse(captured).sections.checks[0].status).toBe('present');
  expect(collections).toBe(1);
  await page.getByRole('button', { name: 'Download reviewed report' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('diagnostic-review.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed report' }).click();
  const download = await downloadPromise;
  expect(await fs.readFile((await download.path())!, 'utf8')).toBe(captured);
  await expect(page.getByRole('status')).toContainText('Nothing was uploaded');
});

test('cancels without exporting and retains the preview when download fails', async ({ page }) => {
  let exports = 0;
  await page.route('**/api/diagnostics/export', async route => { exports++; await route.fulfill({ status: 500, json: { error: canary } }); });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Preview diagnostics' }).click();
  await page.getByRole('button', { name: 'Cancel preview' }).click();
  expect(exports).toBe(0);
  await expect(page.getByLabel('Diagnostic file preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview diagnostics' }).click();
  await page.getByRole('button', { name: 'Download reviewed report' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not export this preview');
  await expect(page.getByLabel('Diagnostic file preview')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText(canary);
});

test('recovers from a guide error and supports an empty selected report', async ({ page }) => {
  let fail = true;
  await page.route('**/api/data-guide', async route => {
    if (fail) { await route.fulfill({ status: 500, json: {} }); } else await route.fallback();
  });
  await page.goto('/#/settings');
  const retry = page.getByRole('button', { name: 'Retry guide' });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(page.getByText('Repositories and worktrees', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview diagnostics' }).click();
  await page.getByRole('checkbox', { name: 'Runtime versions and platform' }).uncheck();
  await expect(page.getByRole('button', { name: 'Download reviewed report' })).toBeEnabled();
  expect(JSON.parse((await page.getByLabel('Diagnostic file preview').textContent())!).sections).toEqual({});
});
