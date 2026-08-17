import { test, expect } from './fixtures';

const workspace = {
  id: 'example',
  branchName: 'example',
  description: 'Resource test workspace',
  repos: [],
  assistants: ['codex'],
  workspacePath: 'C:\\mock-dev\\workspaces\\example',
  createdAt: '2026-08-16T00:00:00.000Z',
};

const skill = {
  id: 'portable-skill',
  name: 'portable-skill',
  title: 'Portable Skill',
  category: 'general',
  description: 'Use when testing resource selection.',
  content: '# Portable Skill',
  custom: true,
};

test.describe('Resource Library', () => {
  test.use({ workspacesData: [workspace] });

  test('keeps workspace edits in a draft until the complete selection is saved', async ({ page }) => {
    let assignmentBody: Record<string, unknown> | null = null;
    const selection = {
      schemaVersion: 1,
      revision: 3,
      enabledSkills: ['portable-skill'],
      enabledAgents: ['reviewer'],
      enabledCategories: ['general'],
    };

    await page.route('**/api/skills**', async (route, request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/skills/categories') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categories: [{ id: 'general', name: 'General', description: 'General skills', custom: true }],
          }),
        });
        return;
      }
      if (pathname === '/api/skills/workspace/example/assign') {
        assignmentBody = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, config: { ...selection, revision: 4, enabledSkills: [] } }),
        });
        return;
      }
      if (pathname === '/api/skills/workspace/example') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ config: selection }),
        });
        return;
      }
      if (pathname === '/api/skills') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ skills: [skill] }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/#/skills');
    await expect(page.getByRole('heading', { name: 'Skill Library' })).toBeVisible();
    await page.getByLabel('Scope:').selectOption('example');

    const toggle = page.getByRole('button', { name: 'Enabled', exact: true });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Disabled', exact: true })).toBeVisible();
    expect(assignmentBody).toBeNull();

    await page.getByRole('button', { name: 'Save selection' }).click();
    await expect.poll(() => assignmentBody).toEqual({
      expectedRevision: 3,
      enabledSkills: [],
      enabledAgents: ['reviewer'],
      enabledCategories: ['general'],
    });
  });
});
