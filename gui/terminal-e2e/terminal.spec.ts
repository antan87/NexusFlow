import { test, expect } from '@playwright/test';

test('one real shell survives window changes and reload, then stops explicitly', async ({ page }) => {
  let launches = 0;
  page.on('websocket', ws => { ws.on('framereceived', frame => { const data = JSON.parse(String(frame.payload)); if (data.type === 'error') console.log('Terminal error:', data.message); }); ws.on('socketerror', error => console.log('Terminal socket:', error)); });
  page.on('request', request => { if (request.url().endsWith('/terminal-test/create')) launches++; });
  await page.addInitScript(() => {
    if (!localStorage.getItem('contextspace_floating_chat_state_v1')) localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ isOpen: true, openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/');
  const pane = page.getByTestId('terminal-pane').filter({ visible: true });
  await pane.getByRole('combobox', { name: 'CLI harness' }).click();
  await page.getByRole('option', { name: 'Shell', exact: true }).click();
  await pane.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(pane.getByRole('status')).toHaveText('Connected');
  const session = await pane.getByLabel('Terminal sessions').inputValue();
  await pane.getByLabel('Screen reader', { exact: true }).check();
  const input = pane.locator('.xterm-helper-textarea');
  const command = process.platform === 'win32' ? "$env:CS_KEEP='42'; Write-Output ('CS_' + 'STARTED')" : "export CS_KEEP=42; printf 'CS_%s\\n' STARTED";
  await input.focus(); await page.keyboard.type(command); await page.keyboard.press('Enter');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_STARTED');
  await page.getByRole('button', { name: 'Maximize floating chat', exact: true }).click();
  const box = await page.getByRole('region', { name: 'Workspace Chat', exact: true }).boundingBox();
  expect(box?.width).toBe(page.viewportSize()!.width);
  await expect.poll(() => pane.getByLabel('Interactive CLI terminal').evaluate(host => {
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return Infinity;
    return screen.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom;
  })).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Restore down floating chat' }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('region', { name: 'Workspace Chat', exact: true }).getByRole('button', { name: 'CLI', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize floating chat' }).click();
  await page.getByTitle('Restore floating workspace chat').click();
  await page.getByRole('button', { name: 'Add Workspace' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'terminal-other' }).click();
  await expect(pane.getByRole('status')).toHaveText('Choose a harness or shell');
  await page.getByRole('tab', { name: 'terminal-test', exact: false }).click();
  await expect(pane.getByRole('status')).toHaveText('Connected');
  await page.reload();
  await expect(pane.getByRole('status')).toHaveText('Connected');
  await expect(pane.getByLabel('Terminal sessions')).toHaveValue(session);
  await expect(pane.getByRole('button', { name: 'Resume session' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pane.locator('.xterm-screen').evaluate(screen => screen.getBoundingClientRect().height)).toBeGreaterThan(100);
  await pane.getByLabel('Screen reader', { exact: true }).check();
  await input.focus();
  await page.keyboard.type(process.platform === 'win32' ? "Write-Output ('CS_ALIVE_' + $env:CS_KEEP)" : "printf 'CS_ALIVE_%s\\n' \"$CS_KEEP\"");
  await page.keyboard.press('Enter');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_ALIVE_42');
  expect(launches).toBe(1);
  await page.getByRole('button', { name: 'Maximize floating chat', exact: true }).click();
  await page.screenshot({ path: 'test-results/terminal-maximized.png' });
  page.once('dialog', dialog => dialog.accept());
  await pane.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(pane.getByRole('status')).toContainText('Exited');
});

test('cross-origin terminal creation and websocket attachment are rejected', async ({ request }) => {
  const headers = { Origin: 'https://untrusted.example', 'x-contextspace-terminal': 'bootstrap' };
  expect((await request.post('/api/terminals/bootstrap', { headers })).status()).toBe(403);
  expect((await request.get('/ws/terminal', { headers })).status()).toBe(403);
});
