import { test, expect } from '@playwright/test';

test('one real shell survives window changes and reload, then stops explicitly', async ({ page }) => {
  test.setTimeout(60_000);
  let launches = 0;
  page.on('websocket', ws => { ws.on('framereceived', frame => { const data = JSON.parse(String(frame.payload)); if (data.type === 'error') console.log('Terminal error:', data.message); }); ws.on('socketerror', error => console.log('Terminal socket:', error)); });
  page.on('request', request => { if (request.url().endsWith('/terminal-test/create')) launches++; });
  // Typing while the shell is handling a resize (SIGWINCH) drops keystrokes on
  // macOS's bash 3.2: a panel toggle resized the PTY and the next command lost
  // its arguments. Commands therefore wait until resizes and the prompt redraw
  // have gone quiet. Tracks every socket, including the one after reload.
  let lastTerminalActivity = Date.now();
  page.on('websocket', ws => {
    ws.on('framesent', frame => { try { if (JSON.parse(String(frame.payload)).type === 'resize') lastTerminalActivity = Date.now(); } catch { /* not a terminal frame */ } });
    ws.on('framereceived', frame => { try { if (JSON.parse(String(frame.payload)).type === 'output') lastTerminalActivity = Date.now(); } catch { /* not a terminal frame */ } });
  });
  const settle = () => expect.poll(() => Date.now() - lastTerminalActivity, { timeout: 10_000, intervals: [100] }).toBeGreaterThanOrEqual(400);
  await page.addInitScript(() => {
    if (!localStorage.getItem('contextspace_floating_chat_state_v1')) localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ isOpen: true, openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/');
  const pane = page.getByTestId('terminal-pane').filter({ visible: true });
  await pane.getByRole('button', { name: 'Start new session', exact: true }).click();
  await pane.getByRole('combobox', { name: 'CLI harness' }).click();
  await page.getByRole('option', { name: 'Shell', exact: true }).click();
  await pane.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  const chat = page.getByRole('region', { name: 'CLI Chat', exact: true });
  const openPaneOptions = () => chat.getByRole('button', { name: 'Pane options' }).click();
  // Code and Docs are inline toolbar buttons, so toggle them directly.
  const toggleInspector = async (name: 'Code' | 'Docs') => { await chat.getByRole('button', { name, exact: true }).click(); };
  await expect(pane.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/terminal-compact.png' });
  // The raw session <select> and the always-on tools row were replaced by one
  // overflow menu, so the saved session and its usage live behind it now.
  // Assert the section rather than a session label: the shell is named by
  // basename, so it is bash on Linux and pwsh.exe or powershell.exe on Windows.
  await openPaneOptions();
  await expect(page.getByText(/saved sessions/i)).toBeVisible();
  await page.screenshot({ path: 'test-results/terminal-pane-options.png' });
  await page.getByRole('menuitem', { name: /Screen reader mode/ }).click();
  const input = pane.locator('.xterm-helper-textarea');
  const run = async (command: string) => {
    await settle();
    await input.focus(); await page.keyboard.type(command); await page.keyboard.press('Enter');
  };
  const command = process.platform === 'win32' ? "$env:CS_KEEP='42'; Write-Output ('CS_' + 'STARTED')" : 'export CS_KEEP=42; echo CS_STARTED';
  await run(command);
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_STARTED');
  // The default window is 760px, above the 520px compact threshold, so the
  // inspector splits and the terminal stays visible beside it.
  await toggleInspector('Code');
  await expect(chat.getByRole('separator', { name: 'Resize code panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await page.screenshot({ path: 'test-results/terminal-compact-inspector.png' });
  await toggleInspector('Code');
  await expect(pane).toBeVisible();
  await run(process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_CODE')" : 'echo CS_${CS_KEEP}_CODE');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_CODE');
  await toggleInspector('Docs');
  await expect(chat.getByRole('separator', { name: 'Resize documents panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await toggleInspector('Docs');
  await expect(pane).toBeVisible();
  await run(process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_DOCS')" : 'echo CS_${CS_KEEP}_DOCS');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_DOCS');
  await page.getByRole('button', { name: 'Maximize floating chat', exact: true }).click();
  const box = await page.getByRole('region', { name: 'CLI Chat', exact: true }).boundingBox();
  expect(box?.width).toBe(page.viewportSize()!.width);
  await toggleInspector('Code');
  const separator = chat.getByRole('separator', { name: 'Resize code panel' });
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await run(process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_WIDE')" : 'echo CS_${CS_KEEP}_WIDE');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_WIDE');
  await toggleInspector('Code');
  await expect.poll(() => pane.getByLabel('Interactive CLI terminal').evaluate(host => {
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return Infinity;
    return screen.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom;
  })).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Restore down floating chat' }).click();
  await page.getByRole('button', { name: 'Minimize floating chat' }).click();
  await expect(page.getByTitle('Restore floating CLI chat')).toContainText('CLI running · hidden');
  await page.getByTitle('Restore floating CLI chat').click();
  await toggleInspector('Code');
  await expect(chat.getByRole('separator', { name: 'Resize code panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await page.getByRole('button', { name: 'Add workspace' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'terminal-other' }).click();
  // "Continue a conversation" moved into the pane overflow with the rest of the
  // secondary actions.
  await openPaneOptions();
  await expect(page.getByRole('menuitem', { name: /Continue a conversation/ })).toBeVisible();
  await page.getByRole('tab', { name: 'terminal-test', exact: false }).click();
  await expect(chat.getByRole('separator', { name: 'Resize code panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await page.reload();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  await expect(pane.getByRole('region', { name: 'Continue a conversation' })).toHaveCount(0);
  await expect.poll(() => pane.locator('.xterm-screen').evaluate(screen => screen.getBoundingClientRect().height)).toBeGreaterThan(100);
  await openPaneOptions();
  await page.getByRole('menuitem', { name: /Screen reader mode/ }).click();
  await run(process.platform === 'win32' ? "Write-Output ('CS_ALIVE_' + $env:CS_KEEP)" : 'echo CS_ALIVE_$CS_KEEP');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_ALIVE_42');
  expect(launches).toBe(1);
  await page.getByRole('button', { name: 'Maximize floating chat', exact: true }).click();
  await page.screenshot({ path: 'test-results/terminal-maximized.png' });
  page.once('dialog', dialog => dialog.accept());
  await pane.getByRole('button', { name: 'End', exact: true }).click();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Ended');
  await expect(pane.getByRole('button', { name: 'End', exact: true })).toHaveCount(0);
});

test('a shell that quits on its own is labeled exited', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ isOpen: true, openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/');
  const pane = page.getByTestId('terminal-pane').filter({ visible: true });
  await pane.getByRole('button', { name: 'Start new session', exact: true }).click();
  await pane.getByRole('combobox', { name: 'CLI harness' }).click();
  await page.getByRole('option', { name: 'Shell', exact: true }).click();
  await pane.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  await pane.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('exit 3');
  await page.keyboard.press('Enter');
  await expect(pane.getByTestId('terminal-state')).toContainText('Exited');
  await expect(pane.getByRole('button', { name: 'End', exact: true })).toHaveCount(0);
});

test('cross-origin terminal creation and websocket attachment are rejected', async ({ request }) => {
  const headers = { Origin: 'https://untrusted.example', 'x-contextspace-terminal': 'bootstrap' };
  expect((await request.post('/api/terminals/bootstrap', { headers })).status()).toBe(403);
  expect((await request.get('/ws/terminal', { headers })).status()).toBe(403);
});
