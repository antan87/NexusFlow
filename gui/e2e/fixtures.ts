import { test as base, expect, type Route } from '@playwright/test';

export type MockDataOptions = {
  configData: any;
  adaptersData: any;
  workspacesData: any;
  workspacesStatusData: any;
  editorDetectData: any;
  workspaceLaunchTargetsData: any;
  updateStatusData: any;
  projectsData: any;
  reposData: { data: any[] };
  aiDetectData: any;
  workflowsTemplatesData: any;
  servicesData: any;
};

export const test = base.extend<MockDataOptions & { setupMocks: void }>({
  configData: [{
    exists: true,
    config: {
      version: '0.2.7',
      devDir: 'C:\\mock-dev',
      workspacesDir: 'C:\\mock-dev\\workspaces',
      defaultAssistant: 'ANTIGRAVITY',
      scanDepth: 2,
    },
  }, { option: true }],
  adaptersData: [{ adapters: [] }, { option: true }],
  workspacesData: [[], { option: true }],
  workspacesStatusData: [{}, { option: true }],
  editorDetectData: [[], { option: true }],
  workspaceLaunchTargetsData: [[
    {
      id: 'codex-desktop', name: 'Codex Desktop',
      description: 'Start a new Codex chat with this folder as its workspace.',
      kind: 'ai-app', icon: 'codex', available: true,
    },
    {
      id: 'claude-desktop', name: 'Claude Desktop',
      description: 'Open Claude Code with this folder selected.',
      kind: 'ai-app', icon: 'claude', available: false,
      unavailableReason: 'Claude Desktop is not installed.',
    },
    {
      id: 'cursor', name: 'Cursor',
      description: 'Open the generated workspace in Cursor.',
      kind: 'editor', icon: 'cursor', available: true,
    },
    {
      id: 'vscode', name: 'VS Code',
      description: 'Open the generated VS Code workspace.',
      kind: 'editor', icon: 'vscode', available: true,
    },
    {
      id: 'vscode-insiders', name: 'VS Code Insiders',
      description: 'Open the generated workspace in Insiders.',
      kind: 'editor', icon: 'vscode-insiders', available: false,
      unavailableReason: 'VS Code Insiders was not detected on PATH.',
    },
  ], { option: true }],
  updateStatusData: [{ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }, { option: true }],
  projectsData: [{ data: [] }, { option: true }],
  reposData: [{ data: [] }, { option: true }],
  aiDetectData: [[], { option: true }],
  workflowsTemplatesData: [{ templates: [] }, { option: true }],
  servicesData: [{ services: [], orchestrationTools: [], runningState: [], runningOrchestrators: [] }, { option: true }],

  setupMocks: [async ({
    page,
    configData,
    adaptersData,
    workspacesData,
    workspacesStatusData,
    editorDetectData,
    workspaceLaunchTargetsData,
    updateStatusData,
    projectsData,
    reposData,
    aiDetectData,
    workflowsTemplatesData,
    servicesData,
  }, use) => {
    const json = (body: unknown) => async (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/api/config', json(configData));
    await page.route('**/api/adapters', json(adaptersData));
    await page.route('**/api/workspaces', json(workspacesData));
    await page.route('**/api/workspaces/status', json(workspacesStatusData));
    await page.route('**/api/editor-detect', json(editorDetectData));
    await page.route('**/api/workspace-launch-targets', json(workspaceLaunchTargetsData));
    await page.route('**/api/update-status', json(updateStatusData));
    await page.route('**/api/projects', json(projectsData?.data ?? projectsData));
    await page.route('**/api/repos', json(reposData?.data ?? reposData));
    await page.route('**/api/ai-detect', json(aiDetectData));
    await page.route('**/api/workflows/templates', json(workflowsTemplatesData));
    await page.route('**/api/workspace/*/sessions**', json({ sessions: [] }));

    // Service log routes — register the more specific /stream matcher first so
    // it wins over the backfill route.
    await page.route('**/api/workspace/*/services/logs/*/stream**', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: init\ndata: {"offset":0}\n\nevent: log\ndata: {"chunk":"hello from sse\\n"}\n\n',
      }),
    );
    await page.route('**/api/workspace/*/services/logs/*', json({ logs: 'backfill line\n', size: 14 }));
    await page.route('**/api/workspace/*/services', json(servicesData));
    await page.route('**/api/workspace/*/changes', json({ changes: [] }));

    await use();
  }, { auto: true }],
});

export { expect };
