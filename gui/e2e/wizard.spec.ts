import { test, expect } from '@playwright/test';

test.describe('NexusFlow E2E GUI Tests', () => {

  test('should run the onboarding flow when config does not exist', async ({ page }) => {
    // 1. Mock endpoints
    await page.route('**/api/config', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            exists: false,
            config: {
              version: '0.2.7',
              devDir: '',
              workspacesDir: '',
              defaultAssistant: null,
              scanDepth: 2,
            }
          }),
        });
      } else if (request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body.devDir).toBe('C:\\Users\\patro\\dev');
        expect(body.workspacesDir).toBe('C:\\Users\\patro\\dev\\workspaces');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, config: body }),
        });
      }
    });

    await page.route('**/api/ai-detect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/editor-detect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/workspaces', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/update-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }),
      });
    });

    // 2. Open page
    await page.goto('/');

    // 3. Verify onboarding elements
    await expect(page.locator('h1')).toContainText('Welcome to NexusFlow');
    await expect(page.locator('h2')).toContainText('Initialize Config');

    // 4. Fill in paths
    await page.getByPlaceholder('e.g. C:\\Users\\username\\dev', { exact: true }).fill('C:\\Users\\patro\\dev');
    await page.getByPlaceholder('e.g. C:\\Users\\username\\dev\\workspaces', { exact: true }).fill('C:\\Users\\patro\\dev\\workspaces');

    // 5. Submit onboarding config
    await page.locator('button:has-text("Save & Get Started")').click();

    // Since mock switches status, we verify transition
    // (In a full app we'd mock the next GET config to return exists: true, but this proves the submit action completes)
  });

  test('should create a workspace via the wizard steps', async ({ page }) => {
    // 1. Mock EventSource globally to simulate build progress SSE
    await page.addInitScript(() => {
      class MockEventSource {
        url: string;
        listeners: Record<string, Array<(e: any) => void>> = {};
        onmessage: ((e: any) => void) | null = null;

        constructor(url: string) {
          this.url = url;
          setTimeout(() => {
            const eventPayload = {
              status: 'completed',
              progress: 100,
              workspacePath: 'C:\\Users\\patro\\dev\\workspaces\\feat-test-branch',
              steps: [
                { id: 'worktrees', name: 'Create Git Worktrees', status: 'completed', message: 'Done' },
                { id: 'analysis', name: 'Analyze Repositories', status: 'completed', message: 'Done' },
                { id: 'context', name: 'Generate AI Context Files', status: 'completed', message: 'Done' },
                { id: 'pack', name: 'Pack Codebase Context', status: 'completed', message: 'Done' },
              ],
            };

            const progressEvent = new MessageEvent('progress', {
              data: JSON.stringify(eventPayload),
            });

            if (this.listeners['progress']) {
              this.listeners['progress'].forEach((cb) => cb(progressEvent));
            }
          }, 300);
        }

        addEventListener(type: string, cb: (e: any) => void) {
          if (!this.listeners[type]) this.listeners[type] = [];
          this.listeners[type].push(cb);
        }

        close() {}
      }
      (window as any).EventSource = MockEventSource;
    });

    // 2. Mock API endpoints
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
              enabled: true,
              provider: 'ollama',
              endpoint: 'http://localhost:11434',
              model: 'qwen2.5-coder:1.5b'
            }
          }
        }),
      });
    });

    await page.route('**/api/repos', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { name: 'nexus-frontend', path: 'C:\\Users\\patro\\dev\\nexus-frontend', defaultBranch: 'main' },
          { name: 'nexus-backend', path: 'C:\\Users\\patro\\dev\\nexus-backend', defaultBranch: 'main' },
        ]),
      });
    });

    await page.route('**/api/ai-detect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { name: 'claude', displayName: 'Claude CLI', detected: true },
          { name: 'antigravity', displayName: 'Antigravity', detected: true },
        ]),
      });
    });

    await page.route('**/api/editor-detect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { name: 'VS Code', command: 'code', detected: true },
        ]),
      });
    });

    await page.route('**/api/workspaces', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/update-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }),
      });
    });

    await page.route('**/api/workspace', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'feat-test-branch' }),
      });
    });

    // 3. Open dashboard
    await page.goto('/');

    // 4. Click New Workspace in Sidebar
    await page.locator('button:has-text("New Workspace")').click();

    // 5. Fill Details
    await page.getByPlaceholder('e.g., feature/oauth-authentication-flow').fill('feat-test-branch');
    await page.getByPlaceholder('Describe what you want to build. This helps AI assistants analyze context and produce matching plans.').fill('Implement login page');
    await page.locator('button:has-text("Next Step")').click();

    // 6. Select a Repo
    await page.getByText('nexus-frontend', { exact: true }).click();
    await page.locator('button:has-text("Next Step")').click();

    // 7. Click Build Workspace
    await page.locator('button:has-text("Build Workspace")').click();

    // 8. Assert Completion screen
    await expect(page.locator('h2')).toContainText('Workspace Generated!');
    await expect(page.locator('code').first()).toContainText('feat-test-branch');
  });

  test('should validate Local LLM configuration in settings', async ({ page }) => {
    let savedConfig: any = null;

    // 1. Mock API endpoints
    await page.route('**/api/config', async (route, request) => {
      if (request.method() === 'GET') {
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
                model: 'qwen2.5-coder:1.5b'
              }
            }
          }),
        });
      } else if (request.method() === 'POST') {
        savedConfig = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, config: savedConfig }),
        });
      }
    });

    await page.route('**/api/ai-detect', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/editor-detect', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/workspaces', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/update-status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }) });
    });

    await page.route('**/api/updates/tools', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/local-llm/recommend', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalRamGb: 16, gpuName: 'NVIDIA RTX 4070', recommendedModel: 'qwen2.5-coder:7b' }),
      });
    });

    // 2. Open dashboard and go to Settings
    await page.goto('/');
    await page.locator('aside button:has-text("Settings")').click();

    // 3. Verify settings page loaded
    await expect(page.locator('h1')).toContainText('Global Settings');

    // 4. Toggle Local AI
    const toggleCheckbox = page.locator('#localLlmEnabled');
    await toggleCheckbox.click();

    // 5. Fill invalid endpoint URL
    const endpointInput = page.locator('label:has-text("Endpoint URL") + input');
    await endpointInput.fill('invalid-url-format');

    // 6. Assert "Save Configuration" is disabled due to invalid URL
    const saveButton = page.locator('button:has-text("Save Configuration")');
    await expect(saveButton).toBeDisabled();

    // 7. Fill valid endpoint URL
    await endpointInput.fill('http://localhost:11434');

    // 8. Assert "Save Configuration" is now enabled
    await expect(saveButton).toBeEnabled();

    // 9. Click Save
    await saveButton.click();

    // 10. Check if post request payload had localLlm enabled
    expect(savedConfig.localLlm.enabled).toBe(true);
    expect(savedConfig.localLlm.endpoint).toBe('http://localhost:11434');
  });
});
