import { test, expect } from './fixtures';

const demoProject = {
  id: 'demo',
  name: 'Demo',
  description: 'Demo project',
  repos: [{ path: 'C:\\mock-dev\\nexus-frontend', defaultBranch: 'main' }],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const repos = [
  { name: 'nexus-frontend', path: 'C:\\mock-dev\\nexus-frontend', defaultBranch: 'main' },
  { name: 'nexus-backend', path: 'C:\\mock-dev\\nexus-backend', defaultBranch: 'main' },
];

test.describe('Projects page', () => {
  test.use({
    reposData: { data: repos },
    workspacesData: [
      {
        id: 'demo-workspace',
        mode: 'in-place',
        projectId: 'demo',
        branchName: 'demo-workspace',
        description: 'Demo workspace',
        repos: ['C:\\mock-dev\\nexus-frontend'],
        assistants: [],
        workspacePath: 'C:\\mock-dev\\nexus-frontend',
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ],
  });

  test('should list, create, and delete projects', async ({ page }) => {
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
          repos: ['C:\\mock-dev\\nexus-backend'],
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
    await expect(page.getByText('C:\\mock-dev\\nexus-frontend')).toBeVisible();

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
