import AxeBuilder from '@axe-core/playwright';
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
  // The plan is read first; editing the goal opens its form in place.
  await expect(page.getByRole('heading', { name: 'Goal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit the goal' }).click();
  await expect(page.getByLabel('Current objective')).toHaveValue('Find the bottleneck');
  return {
    guidance: () => guidance, lifecycle: () => lifecycle,
    /** Another session saves: the brief or the plan moves to a new revision. */
    otherSessionSavesBrief: (patch: Record<string, unknown>) => { guidance = { ...guidance, ...patch, revision: guidance.revision + 1 }; },
    otherSessionSavesPlan: (steps: any[]) => { lifecycle = { ...lifecycle, steps, revision: lifecycle.revision + 1 }; },
  };
}

/** Leave the workspace and come back, as a developer does between tasks. */
async function leaveAndReturn(page: import('@playwright/test').Page) {
  await page.goto('/#/projects');
  await expect(page.getByRole('heading', { name: 'Goal', exact: true })).toHaveCount(0);
  await page.goto('/#/workspaces/demo/plan');
  await expect(page.getByRole('heading', { name: 'Goal', exact: true })).toBeVisible();
}
// Panels that are mounted but hidden also carry a state label; only the one on screen counts.
const draftState = (page: import('@playwright/test').Page) => page.locator('[data-draft-state]:visible');

/** The delivery notes document, with a revision that changes whenever anyone saves. */
async function mockNotes(page: import('@playwright/test').Page, content = '# Delivery order\nProducer, publish, consumer.') {
  let saved = { content, revision: '0'.repeat(64) };
  let version = 0;
  const save = (next: string) => { saved = { content: next, revision: (++version).toString(16).padStart(64, '0') }; };
  await page.route('**/api/workspace/demo/planning-notes', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (body.revision !== saved.revision) return route.fulfill({ status: 409, json: { error: 'Planning notes changed in another session. Reload before saving.' } });
      save(body.content);
    }
    return route.fulfill({ json: saved });
  });
  return { saved: () => saved, otherSessionSaves: save };
}

test('uploads and labels a project source, reads the original, and supersedes it', async ({ page }) => {
  const state = await setupWork(page);
  await page.getByRole('button', { name: 'Edit sources' }).click();
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
  await expect(page.getByRole('button', { name: 'Copy the goal for an assistant' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByRole('status')).toHaveText('Goal saved.');
  expect(state.guidance()).toMatchObject({ workType: 'rewrite', size: 'standard', assignment: { stage: 'design', milestoneId: 'baseline', expectedOutput: 'A measured proposal', stopCondition: 'Stop before implementation' } });
  await expect(page.getByRole('button', { name: 'Copy the goal for an assistant' })).toBeEnabled();
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
  await page.getByRole('button', { name: 'Save goal' }).click();
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
  await page.getByRole('button', { name: 'Edit notes and questions' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue(saved.content);
  await page.getByLabel('Delivery notes', { exact: true }).fill('# My draft');
  await page.getByRole('button', { name: 'Edit the goal' }).click();
  await page.getByRole('button', { name: 'Edit notes and questions' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
  await page.getByRole('button', { name: 'Save delivery notes' }).click();
  await expect(page.getByRole('alert')).toContainText('Your draft is kept');
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
  await page.getByRole('button', { name: 'Reload delivery notes' }).click();
  // Reload fetches the saved notes but never throws the draft away: discarding it is its own choice.
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
  await page.getByRole('button', { name: 'Discard unsaved delivery notes' }).click();
  await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue(saved.content);
  conflict = false;
  await page.getByLabel('Delivery notes', { exact: true }).fill('# Agreed delivery order');
  await page.getByRole('button', { name: 'Save delivery notes' }).click();
  await expect(page.getByRole('status')).toContainText('Delivery notes saved');
  expect(saved.content).toBe('# Agreed delivery order');
  await page.getByRole('heading', { name: 'Goal', exact: true }).scrollIntoViewIfNeeded();
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
  await expect(page.getByText('No milestones. Most work does not need them', { exact: false })).toBeVisible();
  await page.getByLabel('Current objective').fill('Unsaved objective');
  await expect(page.getByRole('button', { name: 'Draft first milestone' })).toBeDisabled();
  await expect(page.getByText('Save the goal before drafting from it.')).toBeVisible();
  await page.getByLabel('Current objective').fill('Find the bottleneck');
  await page.getByRole('button', { name: 'Draft first milestone' }).click();
  await expect(page.getByLabel('Milestone 1 title')).toHaveValue('Find the bottleneck');
  await expect(page.getByText('This milestone is an unsaved draft')).toBeVisible();
  expect(state.lifecycle().steps).toEqual([]);
  await page.getByLabel('Milestone 1 outcome').fill('A measured latency profile');
  await page.getByRole('heading', { name: 'Goal', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/first-milestone-draft.png', fullPage: true });
  await page.getByRole('button', { name: 'Save milestones' }).click();
  expect(state.lifecycle().steps[0]).toMatchObject({ title: 'Find the bottleneck', description: 'A measured latency profile', status: 'pending' });
  await expect(page.getByRole('button', { name: 'Visual Flow' })).toBeVisible();
});

test.describe('unsaved brief drafts', () => {
  test('survive switching sections, leaving the workspace and reloading, and clear once saved', async ({ page }) => {
    await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents: [] } }));
    const state = await setupWork(page);
    await page.getByLabel('Expected output').fill('Merged PRs and a release');
    await page.getByLabel('Stop when').fill('Stop after the release');
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    // The reported loss: type, open Documents, return to Plan.
    await page.goto('/#/workspaces/demo/documents');
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByLabel('Expected output')).toHaveValue('Merged PRs and a release');
    await leaveAndReturn(page);
    await expect(page.getByLabel('Expected output')).toHaveValue('Merged PRs and a release');
    await expect(page.getByRole('status')).toContainText('Unsaved goal edits kept');
    await page.reload();
    await expect(page.getByLabel('Stop when')).toHaveValue('Stop after the release');
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    // Keeping a draft is not saving it.
    expect(state.guidance().assignment.expectedOutput).toBe('');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('status')).toHaveText('Goal saved.');
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    // Nothing is kept any more, so the plan opens for reading, and the goal card shows what was saved.
    await expect(page.getByLabel('Expected output')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Goal', exact: true })).toContainText('Merged PRs and a release');
    await expect(draftState(page)).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('keep the whole draft after a failed save, through a reload', async ({ page }) => {
    await setupWork(page);
    await page.route('**/api/workspace/demo/work', (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, json: { error: 'Disk full' } }) : route.fallback());
    await page.getByLabel('Work type', { exact: true }).selectOption('bug');
    await page.getByLabel('Current objective').fill('Links trap the user');
    await page.getByLabel('Expected output').fill('A fix and a test');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('alert')).toContainText('Disk full');
    await expect(page.getByRole('alert')).toContainText('Your draft is kept');
    await page.reload();
    await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('bug');
    await expect(page.getByLabel('Current objective')).toHaveValue('Links trap the user');
    await expect(page.getByLabel('Expected output')).toHaveValue('A fix and a test');
  });

  test('discarding clears the kept draft', async ({ page }) => {
    await setupWork(page);
    await page.getByLabel('Expected output').fill('Something I changed my mind about');
    await page.getByRole('button', { name: 'Discard unsaved goal changes' }).click();
    await expect(page.getByLabel('Expected output')).toHaveValue('');
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    await expect(page.getByLabel('Expected output')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Goal', exact: true })).not.toContainText('Something I changed my mind about');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('show a conflict, and apply nothing, when another session saved while a draft was kept', async ({ page }) => {
    const state = await setupWork(page);
    await page.getByLabel('Current objective').fill('My objective');
    await page.getByLabel('Expected output').fill('My output');
    await page.goto('/#/projects');
    state.otherSessionSavesBrief({ assignment: { ...state.guidance().assignment, objective: 'Their objective', stage: 'verify' } });
    await page.goto('/#/workspaces/demo/plan');
    const notice = page.getByRole('region', { name: 'Unsaved goal edits conflict' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Yours: My objective');
    await expect(notice).toContainText('Saved: Their objective');
    // Only the clash is listed: the stage was changed by them alone, so it simply follows the saved version.
    await expect(notice).not.toContainText('Current stage');
    await expect(notice).not.toContainText('Expected output');
    // Nothing was applied, and nothing can be saved over the newer version until the user chooses.
    await expect(page.getByLabel('Current objective')).toHaveValue('Their objective');
    await expect(page.getByLabel('Current objective')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save goal' })).toBeDisabled();
    await expect(draftState(page)).toContainText('Conflict');
    const results = await new AxeBuilder({ page }).include('section[aria-label="Unsaved goal edits conflict"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    // The choice is still there after a reload.
    await page.reload();
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Keep my goal edits' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByLabel('Current objective')).toHaveValue('My objective');
    await expect(page.getByLabel('Current objective')).toBeEnabled();
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('status')).toHaveText('Goal saved.');
    expect(state.guidance().assignment).toMatchObject({ objective: 'My objective', expectedOutput: 'My output', stage: 'verify' });
  });

  test('combine edits with a newer save to other fields, unsaved and without a conflict', async ({ page }) => {
    const state = await setupWork(page);
    await page.getByLabel('Expected output').fill('My output');
    await page.goto('/#/projects');
    state.otherSessionSavesBrief({ assignment: { ...state.guidance().assignment, stage: 'verify' } });
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByRole('region', { name: 'Unsaved goal edits conflict' })).toHaveCount(0);
    await expect(page.getByLabel('Expected output')).toHaveValue('My output');
    await expect(page.getByLabel('Current stage')).toHaveValue('verify');
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    expect(state.guidance().assignment.expectedOutput).toBe('');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('status')).toHaveText('Goal saved.');
    expect(state.guidance().assignment).toMatchObject({ expectedOutput: 'My output', stage: 'verify' });
  });

  test('use the saved version when that is the choice', async ({ page }) => {
    const state = await setupWork(page);
    await page.getByLabel('Expected output').fill('My output');
    await page.goto('/#/projects');
    state.otherSessionSavesBrief({ assignment: { ...state.guidance().assignment, expectedOutput: 'Their output' }, size: 'small' });
    await page.goto('/#/workspaces/demo/plan');
    await page.getByRole('button', { name: 'Use the saved goal' }).click();
    await expect(page.getByLabel('Expected output')).toHaveValue('Their output');
    await expect(page.getByLabel('Size', { exact: true })).toHaveValue('small');
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Unsaved goal edits conflict' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Goal', exact: true })).toContainText('Their output');
  });

  test('are not a conflict when only a source document was added meanwhile', async ({ page }) => {
    const state = await setupWork(page);
    await page.getByLabel('Expected output').fill('My output');
    await page.goto('/#/projects');
    state.otherSessionSavesBrief({ documents: [{ id: 'doc-x', title: 'Spec', role: 'reference', status: 'draft', scope: {}, summary: '', url: 'https://example.com/spec', createdAt: '', updatedAt: '' }] });
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByRole('region', { name: 'Unsaved goal edits conflict' })).toHaveCount(0);
    await expect(page.getByLabel('Expected output')).toHaveValue('My output');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('status')).toHaveText('Goal saved.');
    expect(state.guidance().assignment.expectedOutput).toBe('My output');
  });

  test('keep an unsaved milestone draft, and ask before it replaces a plan saved meanwhile', async ({ page }) => {
    const state = await setupWork(page);
    await page.getByRole('button', { name: 'Edit milestones' }).click();
    await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
    await page.getByLabel('Milestone 3 title').fill('Roll out gradually');
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    await leaveAndReturn(page);
    await expect(page.getByRole('status')).toContainText('Unsaved milestone edits kept');
    // Kept edits open where they can be finished.
    await expect(page.getByLabel('Milestone 3 title')).toHaveValue('Roll out gradually');
    expect(state.lifecycle().steps).toHaveLength(2);

    // Progress is recorded by the workflow and is not part of a plan edit: the draft is restored over the current progress.
    await page.goto('/#/projects');
    state.otherSessionSavesPlan([{ id: 'baseline', title: 'Measure baseline', status: 'completed' }, { id: 'improve', title: 'Improve lookup', status: 'pending', dependsOn: ['baseline'] }]);
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByRole('region', { name: 'Unsaved milestones edits conflict' })).toHaveCount(0);
    await expect(page.getByLabel('Milestone 3 title')).toHaveValue('Roll out gradually');
    await expect(page.getByText('Milestone 1 · completed')).toBeVisible();

    // A different saved plan is a conflict, and nothing is applied until the user chooses.
    await page.goto('/#/projects');
    state.otherSessionSavesPlan([{ id: 'baseline', title: 'Measure baseline', description: 'Their outcome', status: 'completed' }, { id: 'improve', title: 'Improve lookup', status: 'pending', dependsOn: ['baseline'] }]);
    await page.goto('/#/workspaces/demo/plan');
    const notice = page.getByRole('region', { name: 'Unsaved milestones edits conflict' });
    await expect(notice).toContainText('Roll out gradually');
    await expect(notice).toContainText('Not in the saved plan');
    await expect(notice).toContainText('Measure baseline — Their outcome');
    await expect(page.getByLabel('Milestone 1 title')).toBeDisabled();
    await page.getByRole('button', { name: 'Use the saved milestones' }).click();
    await expect(page.getByLabel('Milestone 3 title')).toHaveCount(0);
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Unsaved milestones edits conflict' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit milestones' }).click();
    await expect(page.getByLabel('Milestone 3 title')).toHaveCount(0);
  });

  test('say so, and keep the draft in this page, when the device cannot store drafts', async ({ page }) => {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith('contextspace.brief-draft')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    await setupWork(page);
    await page.getByLabel('Expected output').fill('Only in memory');
    await expect(draftState(page)).toHaveText('Unsaved changes — not kept, save before you leave');
    await page.getByRole('button', { name: 'Reload the plan' }).click();
    await expect(page.getByLabel('Expected output')).toHaveValue('Only in memory');
  });
  test('keep unsaved delivery notes, flag them on their tab, and clear them once saved', async ({ page }) => {
    const notes = await mockNotes(page);
    await setupWork(page);
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await page.getByLabel('Delivery notes', { exact: true }).fill('# My draft');
    await expect(draftState(page)).toHaveText('Unsaved changes — kept on this device');
    await page.getByRole('button', { name: 'Edit the goal' }).click();
    await expect(page.locator('[data-notes-state="unsaved"]')).toBeVisible();
    await leaveAndReturn(page);
    // The notes are loaded for them, so the tab says there is a draft without visiting it.
    await expect(page.locator('[data-notes-state="unsaved"]')).toBeVisible();
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
    await expect(page.getByRole('status')).toContainText('Unsaved delivery notes kept');
    expect(notes.saved().content).toContain('# Delivery order');
    await page.reload();
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
    await page.getByRole('button', { name: 'Save delivery notes' }).click();
    await expect(page.getByRole('status')).toContainText('Delivery notes saved');
    expect(notes.saved().content).toBe('# My draft');
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    await expect(page.locator('[data-notes-state="unsaved"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# My draft');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('show both versions when delivery notes were saved elsewhere, and apply neither until chosen', async ({ page }) => {
    const notes = await mockNotes(page);
    await setupWork(page);
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await page.getByLabel('Delivery notes', { exact: true }).fill('# Mine');
    await page.goto('/#/projects');
    notes.otherSessionSaves('# Theirs');
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.locator('[data-notes-state="conflict"]')).toBeVisible();
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    const notice = page.getByRole('region', { name: 'Unsaved delivery notes conflict' });
    await expect(notice).toBeVisible();
    await expect(page.getByLabel('Your unsaved delivery notes')).toHaveValue('# Mine');
    await expect(page.getByLabel('Latest saved delivery notes')).toHaveValue('# Theirs');
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# Theirs');
    await expect(page.getByLabel('Delivery notes', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save delivery notes' })).toBeDisabled();
    const results = await new AxeBuilder({ page }).include('section[aria-label="Unsaved delivery notes conflict"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    await page.reload();
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Keep my delivery notes' }).click();
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# Mine');
    await page.getByRole('button', { name: 'Save delivery notes' }).click();
    await expect(page.getByRole('status')).toContainText('Delivery notes saved');
    expect(notes.saved().content).toBe('# Mine');
  });

  test('use the saved delivery notes when that is the choice', async ({ page }) => {
    const notes = await mockNotes(page);
    await setupWork(page);
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await page.getByLabel('Delivery notes', { exact: true }).fill('# Mine');
    await page.goto('/#/projects');
    notes.otherSessionSaves('# Theirs');
    await page.goto('/#/workspaces/demo/plan');
    await page.getByRole('button', { name: 'Edit notes and questions' }).click();
    await page.getByRole('button', { name: 'Use the saved delivery notes' }).click();
    await expect(page.getByLabel('Delivery notes', { exact: true })).toHaveValue('# Theirs');
    await expect(draftState(page)).toHaveText('Saved');
    await page.reload();
    await expect(page.locator('[data-notes-state="conflict"]')).toHaveCount(0);
  });

  test('keep a half-filled source document through leaving and reloading, for this window only', async ({ page }) => {
    await setupWork(page);
    await page.getByRole('button', { name: 'Edit sources' }).click();
    await page.getByLabel('Document title').fill('Invoice requirements');
    await page.getByLabel('Document role').selectOption('design');
    await page.getByLabel('Source text').fill('# Pasted requirements');
    await expect(draftState(page)).toHaveText('Unsaved — kept until you close this window');
    await leaveAndReturn(page);
    await expect(page.getByRole('status')).toContainText('Unsaved source document edits kept');
    await page.reload();
    await expect(page.getByLabel('Document title')).toHaveValue('Invoice requirements');
    await expect(page.getByLabel('Document role')).toHaveValue('design');
    await expect(page.getByLabel('Source text')).toHaveValue('# Pasted requirements');
    // Pasted source text is not left on the device after the window closes.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('brief-draft.document')))).toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('brief-draft.document')))).toHaveLength(1);
    await page.getByRole('button', { name: 'Add document', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Document saved');
    await page.reload();
    await page.getByRole('button', { name: 'Edit sources' }).click();
    await expect(page.getByLabel('Document title')).toHaveValue('');
    await expect(page.getByLabel('Source text')).toHaveValue('');
  });

  test('discard a half-filled source document', async ({ page }) => {
    await setupWork(page);
    await page.getByRole('button', { name: 'Edit sources' }).click();
    await page.getByLabel('Document title').fill('Not needed');
    await page.getByRole('button', { name: 'Discard unsaved source document' }).click();
    await expect(page.getByLabel('Document title')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Discard unsaved source document' })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Edit sources' }).click();
    await expect(page.getByLabel('Document title')).toHaveValue('');
  });
});
