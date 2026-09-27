import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';

type Folder = { path: string; status: string; message: string; canCreate?: boolean; repoCount?: number };
const ok = (path: string, extra: Partial<Folder> = {}): Folder => ({ path, status: 'ok', message: '', ...extra });

const repos = [
  { name: 'api', path: '/home/me/dev/api', defaultBranch: 'main' },
  { name: 'web', path: '/home/me/dev/web', defaultBranch: 'main' },
];

async function firstRun(page: Page, options: {
  platform?: string;
  validate?: (body: Record<string, string>) => { ok: boolean; devDir?: Folder; workspacesDir?: Folder };
  save?: (route: Route, body: Record<string, unknown>) => Promise<void>;
} = {}) {
  const posts: Array<Record<string, unknown>> = [];
  const suggested = options.platform === 'win32'
    ? { devDir: 'C:\\Users\\me\\dev', workspacesDir: 'C:\\Users\\me\\dev\\workspaces' }
    : { devDir: '/home/me/dev', workspacesDir: '/home/me/dev/workspaces' };
  let saved = false;
  await page.route('**/api/config', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({ json: {
        exists: saved,
        platform: options.platform ?? 'linux',
        suggested,
        config: { version: '1.0.0', devDir: suggested.devDir, workspacesDir: suggested.workspacesDir, defaultAssistant: null, scanDepth: 2 },
      } });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (options.save) return options.save(route, body);
    saved = true;
    const { createWorkspacesDir: _flag, ...stored } = body;
    return route.fulfill({ json: { success: true, config: stored } });
  });
  await page.route('**/api/config/validate', (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    return route.fulfill({ json: options.validate?.(body) ?? { ok: true, devDir: ok(body.devDir, { repoCount: 2 }), workspacesDir: ok(body.workspacesDir) } });
  });
  await page.goto('/');
  return posts;
}

test.use({ reposData: { data: repos } });

test('first run suggests working folders, labels them, and hands repositories to Start work', async ({ page }) => {
  const posts = await firstRun(page);
  await expect(page.getByRole('heading', { name: 'Set up ContextSpace' })).toBeVisible();

  const code = page.getByLabel('Code folder');
  const workspaces = page.getByLabel('Workspaces folder');
  await expect(code).toHaveValue('/home/me/dev');
  await expect(workspaces).toHaveValue('/home/me/dev/workspaces');
  // Examples match the server's platform, not a hard-coded Windows path.
  await expect(code).toHaveAttribute('placeholder', 'e.g. /home/you/dev');
  await expect(page.getByText('2 Git repositories found.')).toBeVisible();
  // Help text and status are announced with the field.
  await expect(code).toHaveAccessibleDescription(/Git repositories.*2 Git repositories found/);

  // Storage choice is available but tucked away.
  await expect(page.getByLabel('Where generated context is stored')).toBeHidden();
  await page.getByText('Advanced', { exact: true }).click();
  await expect(page.getByLabel('Where generated context is stored')).toBeVisible();

  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: "You're set up" })).toBeFocused();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ devDir: '/home/me/dev', workspacesDir: '/home/me/dev/workspaces' });
  expect(posts[0]).not.toHaveProperty('createWorkspacesDir');

  await page.getByRole('checkbox', { name: /web/ }).check();
  await page.getByRole('button', { name: /Start your first task/ }).click();
  await expect(page).toHaveURL(/#\/new\?repo=%2Fhome%2Fme%2Fdev%2Fweb$/);
});

test('shows Windows examples when the server runs on Windows', async ({ page }) => {
  await firstRun(page, { platform: 'win32' });
  await expect(page.getByLabel('Code folder')).toHaveAttribute('placeholder', 'e.g. C:\\Users\\you\\dev');
  await expect(page.getByLabel('Workspaces folder')).toHaveAttribute('placeholder', 'e.g. C:\\Users\\you\\dev\\workspaces');
});

test('explains an unusable folder inline and keeps what the user typed', async ({ page }) => {
  const missing = { path: '/home/me/code', status: 'missing', message: "This folder doesn't exist.", canCreate: true };
  const posts = await firstRun(page, {
    validate: (body) => body.devDir === '/home/me/code'
      ? { ok: false, devDir: missing, workspacesDir: ok(body.workspacesDir) }
      : { ok: true, devDir: ok(body.devDir, { repoCount: 2 }), workspacesDir: ok(body.workspacesDir) },
    save: (route) => route.fulfill({ status: 422, json: { error: 'Check the highlighted folders.', fields: { ok: false, devDir: missing, workspacesDir: ok('/home/me/dev/workspaces') } } }),
  });
  const code = page.getByLabel('Code folder');
  await code.fill('/home/me/code');
  await code.blur();
  await expect(page.getByText("This folder doesn't exist.")).toBeVisible();
  await expect(code).toHaveAttribute('aria-invalid', 'true');

  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('alert')).toContainText('Some folders need attention. Your entries are unchanged.');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(code).toHaveValue('/home/me/code');
  expect(posts).toHaveLength(1);
});

test('announces saving, ignores a second click, and recovers from a failed save', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let attempt = 0;
  const posts = await firstRun(page, {
    save: async (route, body) => {
      attempt += 1;
      if (attempt === 1) {
        await held;
        return route.fulfill({ status: 500, json: { error: 'Disk is full.' } });
      }
      return route.fulfill({ json: { success: true, config: body } });
    },
  });
  await expect(page.getByText('2 Git repositories found.')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save and continue' });
  await save.click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Saving your folders…' })).toBeAttached();
  await page.getByRole('button', { name: 'Saving…' }).click({ force: true });
  release();
  await expect(page.getByRole('alert')).toContainText('Disk is full. Your entries are unchanged — try again.');
  expect(posts).toHaveLength(1);
  await expect(page.getByLabel('Code folder')).toHaveValue('/home/me/dev');

  await save.click();
  await expect(page.getByRole('heading', { name: "You're set up" })).toBeVisible();
  expect(posts).toHaveLength(2);
});

test('creates a missing workspaces folder only through the save the user makes', async ({ page }) => {
  const posts = await firstRun(page, {
    validate: (body) => ({ ok: false, devDir: ok(body.devDir, { repoCount: 2 }), workspacesDir: { path: body.workspacesDir, status: 'missing', message: "This folder doesn't exist.", canCreate: true } }),
  });
  await expect(page.getByText('This folder will be created when you continue.')).toBeVisible();
  await expect(page.getByLabel('Workspaces folder')).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: "You're set up" })).toBeVisible();
  expect(posts[0]).toMatchObject({ createWorkspacesDir: true });
});

test.describe('without repositories', () => {
  test.use({ reposData: { data: [] } });

  test('offers a way to choose another folder or continue', async ({ page }) => {
    await firstRun(page);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('No Git repositories were found in')).toBeVisible();
    await page.getByRole('button', { name: 'Choose another code folder' }).click();
    await expect(page.getByLabel('Code folder')).toHaveValue('/home/me/dev');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/#\/new$/);
  });
});
