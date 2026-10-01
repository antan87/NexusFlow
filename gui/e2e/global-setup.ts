import { chromium, type FullConfig } from '@playwright/test';

/**
 * Load the app once before any test runs.
 *
 * The Vite dev server compiles modules and pre-bundles dependencies on first
 * request. Without this warm-up, whichever test runs first pays for that cold
 * start inside its own assertion timeouts; on a slow Windows CI runner that was
 * enough to fail the first accessibility test until its retry.
 */
export default async function warmDevServer(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Only the module graph matters here; the app may render an error state.
    await page.route('**/api/**', (route) => route.abort());
    await page.goto(baseURL, { waitUntil: 'load', timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
