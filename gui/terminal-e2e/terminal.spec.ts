import { test, expect } from '@playwright/test';

test('one real shell survives window changes and reload, then stops explicitly', async ({ page }) => {
  test.setTimeout(90_000);
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
    if (!localStorage.getItem('contextspace_floating_chat_state_v1')) localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/#/workspaces/terminal-test/chat');
  const chat = page.getByRole('region', { name: 'CLI Chat', exact: true });
  const pane = page.getByTestId('terminal-pane').filter({ visible: true }).first();
  const sessionTabs = chat.getByRole('tablist', { name: 'CLI sessions' }).getByRole('tab');
  await pane.getByRole('group', { name: 'CLI tools' }).getByRole('button', { name: 'Start Shell', exact: true }).click();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  const openPaneOptions = () => pane.getByRole('button', { name: 'Pane options' }).click();
  // Code and Docs are inline toolbar buttons, so toggle them directly.
  // Code is a toolbar button; documents have their place on the workspace rail, and beside the terminal they open
  // from the CLI's output or with Ctrl+Shift+D.
  const toggleInspector = async (name: 'Code' | 'Docs') => {
    if (name === 'Code') await chat.getByRole('button', { name, exact: true }).click();
    else { await pane.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Control+Shift+D'); }
  };
  await expect(pane.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/terminal-compact.png' });
  // The shell is a session tab of its own; the tab is named after the tool.
  await expect(sessionTabs).toHaveCount(1);
  await expect(sessionTabs.first()).toHaveAccessibleName(/^Shell, /);
  await openPaneOptions();
  await page.getByRole('menuitem', { name: /Screen reader mode/ }).click();
  const run = async (target: typeof pane, command: string) => {
    await settle();
    await target.locator('.xterm-helper-textarea').focus(); await page.keyboard.type(command); await page.keyboard.press('Enter');
  };
  const command = process.platform === 'win32' ? "$env:CS_KEEP='42'; Write-Output ('CS_' + 'STARTED')" : 'export CS_KEEP=42; echo CS_STARTED';
  await run(pane, command);
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_STARTED');
  // The inspector splits beside the terminal, which stays visible.
  await toggleInspector('Code');
  await expect(chat.getByRole('separator', { name: 'Resize code panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await page.screenshot({ path: 'test-results/terminal-compact-inspector.png' });
  await toggleInspector('Code');
  await expect(pane).toBeVisible();
  await run(pane, process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_CODE')" : 'echo CS_${CS_KEEP}_CODE');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_CODE');
  await toggleInspector('Docs');
  await expect(chat.getByRole('separator', { name: 'Resize documents panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await toggleInspector('Docs');
  await expect(pane).toBeVisible();
  await run(pane, process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_DOCS')" : 'echo CS_${CS_KEEP}_DOCS');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_DOCS');
  await toggleInspector('Code');
  const separator = chat.getByRole('separator', { name: 'Resize code panel' });
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await run(pane, process.platform === 'win32' ? "Write-Output ('CS_' + $env:CS_KEEP + '_WIDE')" : 'echo CS_${CS_KEEP}_WIDE');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_42_WIDE');
  await toggleInspector('Code');
  await expect.poll(() => pane.getByLabel('Interactive CLI terminal').evaluate(host => {
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return Infinity;
    return screen.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom;
  })).toBeLessThanOrEqual(1);
  // Another workspace's chat, then back: the shell and its open panel are as they were.
  await toggleInspector('Code');
  await chat.getByRole('button', { name: 'Add workspace' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'terminal-other' }).click();
  await expect(page.getByTestId('terminal-pane').filter({ visible: true }).first().getByRole('region', { name: 'Start a CLI session' })).toBeVisible();
  await chat.getByRole('tab', { name: /^Show terminal-test/ }).click();
  await expect(chat.getByRole('separator', { name: 'Resize code panel' })).toHaveCount(1);
  await expect(pane).toBeVisible();
  await toggleInspector('Code');
  await page.reload();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Running');
  // Taken over after the reload, once: one tab, and no start screen.
  await expect(sessionTabs).toHaveCount(1);
  await expect(pane.getByRole('region', { name: 'Start a CLI session' })).toHaveCount(0);
  await expect.poll(() => pane.locator('.xterm-screen').evaluate(screen => screen.getBoundingClientRect().height)).toBeGreaterThan(100);
  await openPaneOptions();
  await page.getByRole('menuitem', { name: /Screen reader mode/ }).click();
  await run(pane, process.platform === 'win32' ? "Write-Output ('CS_ALIVE_' + $env:CS_KEEP)" : 'echo CS_ALIVE_$CS_KEEP');
  await expect(pane.locator('.xterm-accessibility-tree')).toContainText('CS_ALIVE_42');
  expect(launches).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await pane.getByRole('button', { name: 'End', exact: true }).click();
  await expect(pane.getByTestId('terminal-state')).toHaveText('Ended');
  await expect(pane.getByRole('button', { name: 'End', exact: true })).toHaveCount(0);
});

test('two real shells work in one workspace at once, side by side, and both come back after a reload', async ({ page }) => {
  test.setTimeout(90_000);
  let launches = 0;
  page.on('request', request => { if (request.url().endsWith('/terminal-test/create')) launches++; });
  let lastTerminalActivity = Date.now();
  page.on('websocket', ws => {
    ws.on('framesent', frame => { try { if (JSON.parse(String(frame.payload)).type === 'resize') lastTerminalActivity = Date.now(); } catch { /* not a terminal frame */ } });
    ws.on('framereceived', frame => { try { if (JSON.parse(String(frame.payload)).type === 'output') lastTerminalActivity = Date.now(); } catch { /* not a terminal frame */ } });
  });
  const settle = () => expect.poll(() => Date.now() - lastTerminalActivity, { timeout: 10_000, intervals: [100] }).toBeGreaterThanOrEqual(400);
  await page.addInitScript(() => {
    if (!localStorage.getItem('contextspace_floating_chat_state_v1')) localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/#/workspaces/terminal-test/chat');
  const chat = page.getByRole('region', { name: 'CLI Chat', exact: true });
  const panes = page.getByTestId('terminal-pane').filter({ visible: true });
  const sessionTabs = chat.getByRole('tablist', { name: 'CLI sessions' }).getByRole('tab');
  const run = async (index: number, command: string) => {
    await settle();
    await panes.nth(index).locator('.xterm-helper-textarea').focus(); await page.keyboard.type(command); await page.keyboard.press('Enter');
  };
  const screenOf = (index: number) => panes.nth(index).locator('.xterm-accessibility-tree');
  const readable = async (index: number) => { await panes.nth(index).getByRole('button', { name: 'Pane options' }).click(); await page.getByRole('menuitem', { name: /Screen reader mode/ }).click(); };

  await panes.first().getByRole('group', { name: 'CLI tools' }).getByRole('button', { name: 'Start Shell', exact: true }).click();
  await expect(panes.first().getByTestId('terminal-state')).toHaveText('Running');
  await readable(0);
  await run(0, process.platform === 'win32' ? "$env:CS_SIDE='left'; Write-Output 'CS_LEFT_READY'" : 'export CS_SIDE=left; echo CS_LEFT_READY');
  await expect(screenOf(0)).toContainText('CS_LEFT_READY');

  // A second CLI in the same workspace, from the + beside the tabs.
  await chat.getByRole('button', { name: 'Start another CLI' }).click();
  await page.getByRole('menuitem', { name: 'Start Shell' }).click();
  await expect(sessionTabs).toHaveCount(2);
  await expect(sessionTabs.nth(1)).toHaveAccessibleName(/^Shell 2, /);
  await expect(sessionTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panes.first().getByTestId('terminal-state')).toHaveText('Running');
  await readable(0);
  // Its own shell: the first one's variable is not set here.
  await run(0, process.platform === 'win32' ? "Write-Output ('CS_SIDE=' + $env:CS_SIDE + '.')" : 'echo CS_SIDE=${CS_SIDE}.');
  await expect(screenOf(0)).toContainText('CS_SIDE=.');

  // Side by side: both at once, in tab order, each still its own.
  await chat.getByRole('button', { name: 'Show two sessions side by side' }).click();
  await expect(panes).toHaveCount(2);
  const [left, right] = [await panes.nth(0).boundingBox(), await panes.nth(1).boundingBox()];
  expect(left!.x).toBeLessThan(right!.x);
  await run(0, process.platform === 'win32' ? "Write-Output ('CS_STILL_' + $env:CS_SIDE)" : 'echo CS_STILL_$CS_SIDE');
  await expect(screenOf(0)).toContainText('CS_STILL_left');
  await run(1, process.platform === 'win32' ? "Write-Output ('CS_RIGHT_' + $env:CS_SIDE + '.')" : 'echo CS_RIGHT_${CS_SIDE}.');
  await expect(screenOf(1)).toContainText('CS_RIGHT_.');
  await page.screenshot({ path: 'test-results/terminal-two-sessions.png' });
  expect(launches).toBe(2);

  // A reload brings both back, each in one tab, without starting anything.
  await page.reload();
  await expect(sessionTabs).toHaveCount(2);
  await expect(panes.first().getByTestId('terminal-state')).toHaveText('Running');
  await sessionTabs.nth(1).click();
  await expect(panes.first().getByTestId('terminal-state')).toHaveText('Running');
  expect(launches).toBe(2);

  // Closing a tab whose shell runs asks first, then ends that shell only.
  page.once('dialog', dialog => dialog.accept());
  await sessionTabs.nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(sessionTabs).toHaveCount(1);
  await expect(panes.first().getByTestId('terminal-state')).toHaveText('Running');
  await readable(0);
  await run(0, process.platform === 'win32' ? "Write-Output ('CS_LAST_' + $env:CS_SIDE)" : 'echo CS_LAST_$CS_SIDE');
  await expect(screenOf(0)).toContainText('CS_LAST_left');
});

test('a shell that quits on its own is labeled exited', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ openTabs: ['terminal-test'], activeTab: 'terminal-test' }));
  });
  await page.goto('/#/workspaces/terminal-test/chat');
  const pane = page.getByTestId('terminal-pane').filter({ visible: true }).first();
  await pane.getByRole('group', { name: 'CLI tools' }).getByRole('button', { name: 'Start Shell', exact: true }).click();
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
