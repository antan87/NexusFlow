import { test, expect } from './fixtures';

test.use({ workspacesData: [{
  id: 'demo', branchName: 'demo', description: 'Improve invoice performance', repos: ['C:/dev/demo'],
  assistants: [], workspacePath: 'C:/ws/demo', projectId: 'billing', createdAt: '2026-06-01T00:00:00.000Z',
}] });

async function setupWork(page: import('@playwright/test').Page, empty = false) {
  let lifecycle: any = { workspaceId: 'demo', flowType: 'feature', revision: 0, steps: [
    { id: 'baseline', title: 'Measure baseline', status: 'in_progress' },
    { id: 'improve', title: 'Improve lookup', status: 'pending', dependsOn: ['baseline'] },
  ], fleet: [], updatedAt: '' };
  if (empty) lifecycle.steps = [];
  let guidance: any = { version: 1, revision: 0, workType: 'performance', size: 'epic',
    assignment: { stage: 'investigate', objective: 'Find the bottleneck', expectedOutput: '', stopCondition: '' }, documents: [],
  };
  const originals = new Map<string, string>();
  const context = () => ({ guidance, lifecycle, projectId: 'billing', sharedDocuments: [], assignment: `Stage: ${guidance.assignment.stage}\n${guidance.assignment.objective}` });
  await page.route('**/api/workspace/demo/plan', (route) => route.fulfill({ json: { content: '# Repository dependencies' } }));
  await page.route('**/api/workspace/demo/lifecycle', (route) => route.fulfill({ json: { lifecycle, report: null } }));
  await page.route('**/api/workspace/demo/work', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(guidance.revision);
      guidance = { ...guidance, ...body, revision: guidance.revision + 1 };
    }
    await route.fulfill({ json: context() });
  });
  await page.route('**/api/workspace/demo/work/documents', async (route) => {
    const { content, revision, ...body } = route.request().postDataJSON();
    expect(revision).toBe(guidance.revision);
    const doc = { ...body, id: `doc-${guidance.documents.length}`, createdAt: '', updatedAt: '' };
    originals.set(doc.id, content);
    guidance = { ...guidance, revision: guidance.revision + 1, documents: [...guidance.documents, doc] };
    await route.fulfill({ json: context() });
  });
  await page.route('**/api/workspace/demo/work/documents/*', async (route) => {
    const id = route.request().url().split('/').pop()!;
    if (route.request().method() === 'PATCH') {
      const { revision, ...body } = route.request().postDataJSON();
      expect(revision).toBe(guidance.revision);
      guidance = { ...guidance, revision: guidance.revision + 1, documents: guidance.documents.map((doc: any) => doc.id === id ? { ...doc, ...body } : doc) };
      return route.fulfill({ json: context() });
    }
    await route.fulfill({ json: { document: guidance.documents.find((doc: any) => doc.id === id), content: originals.get(id), location: 'source.md' } });
  });
  await page.route('**/api/workspace/demo/lifecycle/plan', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(lifecycle.revision);
    lifecycle = { ...lifecycle, steps: body.steps, revision: lifecycle.revision + 1 };
    await route.fulfill({ json: { lifecycle } });
  });
  await page.goto('/#/workspaces/demo/plan');
  await expect(page.getByRole('heading', { name: 'Work brief & sources' })).toBeVisible();
  await expect(page.getByLabel('Current objective')).toHaveValue('Find the bottleneck');
  return { guidance: () => guidance, lifecycle: () => lifecycle };
}

test('uploads and labels a project source, reads the original, and supersedes it', async ({ page }) => {
  const state = await setupWork(page);
  await page.getByRole('button', { name: 'Source documents', exact: true }).click();
  await page.getByLabel('Upload text document').setInputFiles({ name: 'requirements.md', mimeType: 'text/markdown', buffer: Buffer.from('# Invoice requirements\nKeep totals exact.') });
  await expect(page.getByLabel('Document title')).toHaveValue('requirements.md');
  await expect(page.getByLabel('Document status')).toHaveValue('draft');
  await page.getByLabel('Document status').selectOption('approved');
  await page.getByLabel('Document scope').selectOption('project');
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Document saved');
  expect(state.guidance().documents[0]).toMatchObject({ role: 'requirements', status: 'approved', scope: { project: true } });
  await page.getByRole('button', { name: 'Read requirements.md' }).click();
  await expect(page.getByText('# Invoice requirements\nKeep totals exact.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit requirements.md' }).click();
  await page.getByLabel('Document status').selectOption('superseded');
  await page.getByRole('button', { name: 'Save document labels' }).click();
  await expect.poll(() => state.guidance().documents[0].status).toBe('superseded');
});

test('saves independent type, size, stage, scope, and stopping point', async ({ page }) => {
  const state = await setupWork(page);
  await page.getByLabel('Work type', { exact: true }).selectOption('rewrite');
  await page.getByLabel('Size', { exact: true }).selectOption('standard');
  await page.getByLabel('Current stage').selectOption('design');
  await page.getByLabel('Assignment scope').selectOption('baseline');
  await page.getByLabel('Expected output').fill('A measured proposal');
  await page.getByLabel('Stop when').fill('Stop before implementation');
  await expect(page.getByRole('button', { name: 'Copy AI assignment' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save AI assignment' }).click();
  await expect(page.getByRole('status')).toHaveText('AI assignment saved.');
  expect(state.guidance()).toMatchObject({ workType: 'rewrite', size: 'standard', assignment: { stage: 'design', milestoneId: 'baseline', expectedOutput: 'A measured proposal', stopCondition: 'Stop before implementation' } });
  await expect(page.getByRole('button', { name: 'Copy AI assignment' })).toBeEnabled();
});

test('adds a dependent milestone without resetting existing progress', async ({ page }) => {
  const state = await setupWork(page);
  await page.getByRole('button', { name: 'Edit milestones' }).click();
  await page.getByRole('button', { name: 'Remove milestone 1', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('depend on it');
  await expect(page.getByLabel('Milestone 1 title')).toHaveValue('Measure baseline');
  await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await page.getByLabel('Milestone 3 title').fill('Roll out gradually');
  await page.getByLabel('Milestone 3 outcome').fill('Compare production timings');
  await page.getByRole('group', { name: 'Milestone 3 dependencies', exact: true }).getByLabel('Improve lookup').check();
  await page.getByLabel('Milestone 3 repository (optional)').fill('billing-api');
  await page.getByLabel('Milestone 3 work item / PR (optional)').fill('PBI-123');
  await page.getByLabel('Milestone 3 unblock condition (optional)').fill('Package published');
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Milestones saved');
  expect(state.lifecycle().steps[0].status).toBe('in_progress');
  expect(state.lifecycle().steps[2]).toMatchObject({ title: 'Roll out gradually', repo: 'billing-api', workItem: 'PBI-123', unblockCondition: 'Package published', dependsOn: ['improve'], status: 'pending' });
  await expect(page.getByText('Roll out gradually', { exact: true }).last()).toBeVisible();
});

test('keeps the assignment draft when another session changed the saved revision', async ({ page }) => {
  await setupWork(page);
  await page.route('**/api/workspace/demo/work', (route) => route.fulfill({ status: 409, json: { error: 'The brief changed in another session. Reload before saving.' } }));
  await page.getByLabel('Current objective').fill('My unsaved objective');
  await page.getByRole('button', { name: 'Save AI assignment' }).click();
  await expect(page.getByRole('alert')).toContainText('another session');
  await expect(page.getByLabel('Current objective')).toHaveValue('My unsaved objective');
});

test('keeps delivery notes through section switches and save conflicts, then reloads and saves', async ({ page }) => {
  await setupWork(page);
  let saved = { content: '# Delivery order\nProducer, publish, consumer.', revision: 'a'.repeat(64) };
  let conflict = true;
  await page.route('**/api/workspace/demo/planning-notes', async (route) => {
    if (route.request().method() === 'PUT') {
      if (conflict) return route.fulfill({ status: 409, json: { error: 'Planning notes changed in another session. Reload before saving.' } });
      expect(route.request().postDataJSON().revision).toBe(saved.revision);
      saved = { content: route.request().postDataJSON().content, revision: 'b'.repeat(64) };
    }
    return route.fulfill({ json: saved });
  });
  await page.getByRole('button', { name: 'Delivery notes & questions' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue(saved.content);
  await page.getByLabel('Delivery notes', { exact: true }).fill('# My draft');
  await page.getByRole('button', { name: 'AI assignment', exact: true }).click();
  await page.getByRole('button', { name: 'Delivery notes & questions' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
  await page.getByRole('button', { name: 'Save delivery notes' }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is kept');
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
  await page.getByRole('button', { name: 'Reload delivery notes' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue(saved.content);
  conflict = false;
  await page.getByLabel('Delivery notes', { exact: true }).fill('# Agreed delivery order');
  await page.getByRole('button', { name: 'Save delivery notes' }).click();
  await expect(page.getByRole('status')).toContainText('Delivery notes saved');
  expect(saved.content).toBe('# Agreed delivery order');
  await page.getByRole('heading', { name: 'Work brief & sources' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/contextspace-delivery-notes.png', fullPage: true });
});


test('hides unused milestones and supports an empty plan after removing custom outcomes', async ({ page }) => {
  const state = await setupWork(page, true);
  await expect(page.getByText('Iterations:', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Visual Flow', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add milestones', exact: true }).click();
  await expect(page.getByLabel('Milestone 1 title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await page.getByLabel('Milestone 1 title').fill('Browse root documents');
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Visual Flow', exact: true })).toBeVisible();
  expect(state.lifecycle().steps[0].dependsOn).toEqual([]);
  await page.getByRole('button', { name: 'Remove milestone 1', exact: true }).click();
  await page.getByRole('button', { name: 'Save milestones', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Visual Flow', exact: true })).toHaveCount(0);
  expect(state.lifecycle().steps).toEqual([]);
  await page.screenshot({ path: 'test-results/optional-milestones.png', fullPage: true });
});

test('offers an unsaved first milestone from the assignment without starting work', async ({ page }) => {
  const state = await setupWork(page, true);
  await expect(page.getByText('No milestones saved yet')).toBeVisible();
  await page.getByLabel('Current objective').fill('Unsaved objective');
  await expect(page.getByRole('button', { name: 'Draft first milestone' })).toBeDisabled();
  await expect(page.getByText('Save the AI assignment before drafting from it.')).toBeVisible();
  await page.getByLabel('Current objective').fill('Find the bottleneck');
  await page.getByRole('button', { name: 'Draft first milestone' }).click();
  await expect(page.getByLabel('Milestone 1 title')).toHaveValue('Find the bottleneck');
  await expect(page.getByText('This milestone is an unsaved draft')).toBeVisible();
  expect(state.lifecycle().steps).toEqual([]);
  await page.getByLabel('Milestone 1 outcome').fill('A measured latency profile');
  await page.getByRole('heading', { name: 'Work brief & sources' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/first-milestone-draft.png', fullPage: true });
  await page.getByRole('button', { name: 'Save milestones' }).click();
  expect(state.lifecycle().steps[0]).toMatchObject({ title: 'Find the bottleneck', description: 'A measured latency profile', status: 'pending' });
  await expect(page.getByRole('button', { name: 'Visual Flow' })).toBeVisible();
});
