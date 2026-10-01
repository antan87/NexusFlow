import { defineConfig, devices } from '@playwright/test';

/**
 * Port for the E2E dev server. Override with PLAYWRIGHT_PORT when 4173 is already taken.
 *
 * This value feeds the baseURL and the webServer together: a mismatch makes Playwright wait for a
 * server that never answers, which reads as a hung run rather than a config error.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Compile the app once so the first test does not absorb the dev server's cold start. */
  globalSetup: './e2e/global-setup.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? 'dot' : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Keep React's development StrictMode checks active in E2E. Production
   * bundling is verified separately by `npm run build`. */
  webServer: {
    command: `npm run dev -- --port ${port} --host 127.0.0.1`,
    url: baseURL,
    /* Never reuse a server that is already listening on this port.
     *
     * A dev server here is almost always a *different checkout* — several workspaces on one machine
     * share it. Reusing one silently runs the whole suite against another workspace's app, so a
     * green result proves nothing about the code under test. That happened here: a suite reported
     * 98 passed while serving a different branch entirely, and the failure only surfaced because a
     * test asserted a value that branch did not have.
     *
     * If the port is occupied the run now fails immediately and says so, which is the correct
     * outcome. Use PLAYWRIGHT_PORT to move out of the way, or stop the other server. */
    reuseExistingServer: false,
  },
});
