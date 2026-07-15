import { test, expect, type Page } from '@playwright/test';

const demoProject = {
  id: 'demo',
  name: 'Demo',
  description: 'Demo project',
  repos: [{ path: 'C:\\Users\\patro\\dev\\nexus-frontend', defaultBranch: 'main' }],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const repos = [
  { name: 'nexus-frontend', path: 'C:\\Users\\patro\\dev\\nexus-frontend', defaultBranch: 'main' },
  { name: 'nexus-backend', path: 'C:\\Users\\patro\\dev\\nexus-backend', defaultBranch: 'main' },
];

async function mockAppShell(page: Page) {
  await page.route('**/api/adapters', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adapters: [] }) });
  });

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        exists: true,
        config: {
          version: '0.2.7',
          devDir: 'C:\\Users\\patro\\dev',
          workspacesDir: 'C:\\Users\\patro\\dev\\workspaces',
          defaultAssistant: 'ANTIGRAVITY',
          scanDepth: 2,
          localLlm: {
            enabled: false,
            provider: 'ollama',
            endpoint: 'http://localhost:11434',
            model: 'qwen2.5-coder:1.5b',
          },
        },
      }),
    });
  });

  await page.route('**/api/repos', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(repos) });
  });

  await page.route('**/api/ai-detect', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/editor-detect', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/workflows/templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
  });

  await page.route('**/api/update-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }),
    });
  });

  await page.route('**/api/workspaces/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route('**/api/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'demo-workspace',
          mode: 'in-place',
          projectId: 'demo',
          branchName: 'demo-workspace',
          description: 'Demo workspace',
          repos: ['C:\\Users\\patro\\dev\\nexus-frontend'],
          assistants: [],
          workspacePath: 'C:\\Users\\patro\\dev\\nexus-frontend',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      ]),
    });
  });
}

test.describe('Projects page', () => {
  test('should list, create, and delete projects', async ({ page }) => {
    await mockAppShell(page);

    let projects = [demoProject];
    let createBody: any = null;
    let deletedId: string | null = null;

    await page.route('**/api/projects**', async (route, request) => {
      const url = new URL(request.url());
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');

      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) });
        return;
      }

      if (request.method() === 'POST') {
        createBody = request.postDataJSON();
        expect(createBody).toEqual({
          name: 'Billing',
          description: 'Billing repos',
          repos: ['C:\\Users\\patro\\dev\\nexus-backend'],
        });
        projects = [
          ...projects,
          {
            id: 'billing',
            name: createBody.name,
            description: createBody.description,
            repos: [{ path: createBody.repos[0], defaultBranch: 'main' }],
            createdAt: '2026-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z',
          },
        ];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects.at(-1)) });
        return;
      }

      if (request.method() === 'DELETE') {
        deletedId = id;
        expect(deletedId).toBe('demo');
        projects = projects.filter((project) => project.id !== id);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
    });

    await page.goto('/#/projects');

    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Demo' })).toBeVisible();
    await expect(page.getByText('C:\\Users\\patro\\dev\\nexus-frontend')).toBeVisible();

    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('Billing');
    await page.getByLabel('Description (optional)').fill('Billing repos');
    await page.getByRole('checkbox', { name: 'nexus-backend' }).click();
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect.poll(() => createBody?.name).toBe('Billing');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeHidden();

    await page.getByRole('button', { name: 'Remove Demo' }).click();
    await expect(page.getByRole('heading', { name: /Remove/ })).toBeVisible();
    await page.getByRole('button', { name: 'Remove project' }).click();

    await expect.poll(() => deletedId).toBe('demo');
    await expect(page.getByRole('heading', { name: 'Demo' })).toBeHidden();
  });
});
