import { test as base, expect, type Route } from '@playwright/test';

export type MockDataOptions = {
  configData: any;
  adaptersData: any;
  workspacesData: any;
  workspacesStatusData: any;
  editorDetectData: any;
  updateStatusData: any;
  projectsData: any;
  reposData: { data: any[] };
  aiDetectData: any;
  workflowsTemplatesData: any;
};

export const test = base.extend<MockDataOptions & { setupMocks: void }>({
  configData: [{
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
  }, { option: true }],
  adaptersData: [{ adapters: [] }, { option: true }],
  workspacesData: [[], { option: true }],
  workspacesStatusData: [{}, { option: true }],
  editorDetectData: [[], { option: true }],
  updateStatusData: [{ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }, { option: true }],
  projectsData: [{ data: [] }, { option: true }],
  reposData: [{ data: [] }, { option: true }],
  aiDetectData: [[], { option: true }],
  workflowsTemplatesData: [{ templates: [] }, { option: true }],

  setupMocks: [async ({
    page,
    configData,
    adaptersData,
    workspacesData,
    workspacesStatusData,
    editorDetectData,
    updateStatusData,
    projectsData,
    reposData,
    aiDetectData,
    workflowsTemplatesData,
  }, use) => {
    const json = (body: unknown) => async (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/api/config', json(configData));
    await page.route('**/api/adapters', json(adaptersData));
    await page.route('**/api/workspaces', json(workspacesData));
    await page.route('**/api/workspaces/status', json(workspacesStatusData));
    await page.route('**/api/editor-detect', json(editorDetectData));
    await page.route('**/api/update-status', json(updateStatusData));
    await page.route('**/api/projects', json(projectsData?.data ?? projectsData));
    await page.route('**/api/repos', json(reposData?.data ?? reposData));
    await page.route('**/api/ai-detect', json(aiDetectData));
    await page.route('**/api/workflows/templates', json(workflowsTemplatesData));

    // Dashboard extra common routes
    await page.route('**/api/workspace/*/services', json({ services: [], orchestrationTools: [], runningState: [] }));
    await page.route('**/api/workspace/*/changes', json({ changes: [] }));

    await use();
  }, { auto: true }],
});

export { expect };
