import { defineConfig } from '@playwright/test';

/**
 * E2E suite that drives the real Electron app (main.js), which itself boots
 * the NexusFlow backend from ../dist. Prerequisite: run `npm run build` at
 * the repo root first so dist/ and dist/gui exist.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    trace: 'on-first-retry',
  },
});
