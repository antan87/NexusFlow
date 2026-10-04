import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Pasting into the CLI. Text goes in as typed text. A screenshot (an image with no text) is handed to Claude Code or
 * Codex the way a desktop terminal does: as Ctrl+V, after which the CLI reads the image from the clipboard itself.
 * A plain shell cannot take an image, so it says so instead.
 */
const workspace = { id: 'feature-x', branchName: 'feature-x', description: 'Paste', repos: [], assistants: [], workspacePath: '/tmp/feature-x', createdAt: '2026-09-20T00:00:00Z' };
test.use({ workspacesData: [workspace] });

async function openTerminal(page: Page, target: 'claude' | 'shell') {
  const typed: string[] = [];
  const terminal = { id: 't1', workspace: 'feature-x', target, label: target === 'claude' ? 'Claude Code' : 'bash', cwd: '/tmp/feature-x', state: 'running' };
  await page.route('**/api/terminals/feature-x/status', (route) => route.fulfill({ json: { available: true, sessions: [terminal], targets: [{ id: target, name: target, available: true, reason: null }] } }));
  await page.route('**/api/workspace/feature-x/sessions*', (route) => route.fulfill({ json: { sessions: [] } }));
  await page.routeWebSocket('**/ws/terminal', (socket) => socket.onMessage((message) => {
    const parsed = JSON.parse(String(message));
    if (parsed.type === 'input') typed.push(parsed.data);
    if (parsed.type !== 'attach') return;
    socket.send(JSON.stringify({ type: 'ready', terminal, truncated: false }));
    socket.send(JSON.stringify({ type: 'replayed' }));
  }));
  await page.goto('/#/workspaces/feature-x/chat');
  const pane = page.getByTestId('terminal-pane').filter({ visible: true });
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  return { typed, pane };
}

/** A paste event as the browser fires it, on the terminal's input. */
const paste = (page: Page, contents: { text?: string; image?: boolean }) => page.locator('.xterm-helper-textarea').first().evaluate((element, { text, image }) => {
  const payload = new DataTransfer();
  if (text) payload.setData('text/plain', text);
  if (image) payload.items.add(new File(['image bytes'], 'screenshot.png', { type: 'image/png' }));
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}, contents);

test('a screenshot pasted into Claude Code reaches it as Ctrl+V, so it reads the image itself', async ({ page }) => {
  const { typed, pane } = await openTerminal(page, 'claude');
  expect(await paste(page, { image: true })).toBe(true);
  await expect.poll(() => typed).toEqual(['\x16']);
  await expect(pane.getByRole('alert')).toHaveCount(0);
});

test('text with an image beside it is pasted as text, and the CLI is not asked for the image', async ({ page }) => {
  const { typed } = await openTerminal(page, 'claude');
  await paste(page, { text: 'copied text', image: true });
  await expect.poll(() => typed.join('')).toContain('copied text');
  expect(typed.join('')).not.toContain('\x16');
});

test('a plain shell cannot take a screenshot, and says so instead of sending anything', async ({ page }) => {
  const { typed, pane } = await openTerminal(page, 'shell');
  expect(await paste(page, { image: true })).toBe(true);
  await expect(pane.getByRole('alert')).toContainText('The clipboard contains an image but no text');
  await page.waitForTimeout(300);
  expect(typed).toEqual([]);
});
