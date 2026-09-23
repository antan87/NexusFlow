import { test, expect } from './fixtures';

const workspace = { id: 'feature-x', branchName: 'feature-x', description: 'Inspect work', repos: ['C:/repo'], assistants: ['codex'], workspacePath: 'C:/ws/feature-x', createdAt: '2026-09-20T00:00:00Z' };
const terminal = { id: '0199a213-81c0-7800-8aa1-bbab2a035a50', workspace: 'feature-x', target: 'shell', label: 'bash', cwd: workspace.workspacePath, state: 'running' };

test.use({ workspacesData: [workspace], viewport: { width: 1450, height: 950 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/terminals/bootstrap', route => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/feature-x/status', route => route.fulfill({ json: { available: true, sessions: [terminal], targets: [{ id: 'shell', name: 'Shell', available: true, reason: null }] } }));
});

test('shows expandable changed and repository file trees beside the CLI terminal', async ({ page }) => {
  const changed = { repoName: 'repo', repoPath: 'C:/repo', files: [{ file: 'src/nested/changed.ts', type: 'modified', additions: 1, deletions: 0 }] };
  await page.route('**/api/workspace/feature-x/changes?include=all', route => route.fulfill({ json: { changes: [{ ...changed, files: [...changed.files, { file: 'src/nested/clean.ts', type: 'unchanged' }] }] } }));
  await page.route('**/api/workspace/feature-x/changes', route => route.fulfill({ json: { changes: [changed] } }));
  await page.route('**/api/workspace/feature-x/changes/diff?*', route => route.fulfill({ json: { diff: '', fileContent: 'export const changed = 1;\n', originalContent: 'export const changed = 0;\n' } }));
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  await chat.getByRole('button', { name: 'Show code' }).click();
  const code = chat.getByRole('region', { name: 'Workspace code' });
  await expect(code.getByRole('navigation', { name: 'repo changes' })).toBeVisible();
  await expect(code.getByText('src', { exact: true })).toBeVisible();
  await code.getByRole('button', { name: /changed\.ts/ }).click();
  await expect(code.getByText('repo/src/nested/changed.ts')).toBeVisible();
  await code.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(code.getByRole('navigation', { name: 'repo files' }).getByRole('button', { name: /clean\.ts/ })).toBeVisible();
  await code.getByRole('button', { name: /clean\.ts/ }).click();
  await expect(code.getByText('repo/src/nested/clean.ts')).toBeVisible();
  await expect(chat.getByTestId('terminal-pane')).toBeVisible();
});

test('uses ordinary terminal copy and paste shortcuts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  const inputs: string[] = [];
  await page.routeWebSocket('**/ws/terminal', socket => {
    socket.onMessage(message => {
      const item = JSON.parse(String(message));
      if (item.type === 'attach') {
        socket.send(JSON.stringify({ type: 'ready', terminal, truncated: false }));
        socket.send(JSON.stringify({ type: 'output', data: 'copy this line\r\n' }));
        socket.send(JSON.stringify({ type: 'replayed' }));
      }
      if (item.type === 'input') inputs.push(item.data);
    });
  });
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const pane = page.getByTestId('terminal-pane');
  await expect(pane.getByRole('status')).toContainText('Connected');
  const screen = pane.locator('.xterm-screen');
  const bounds = await screen.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 1, bounds!.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 130, bounds!.y + 10);
  await page.mouse.up();
  await screen.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('copy this line');
  await screen.click({ button: 'right' });
  await pane.getByRole('menuitem', { name: 'Copy selection' }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))).toBe(true);
  await page.evaluate(() => navigator.clipboard.writeText('pasted into CLI'));
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => inputs.join('')).toContain('pasted into CLI');
  expect(inputs.join('')).not.toContain('\x16');
  await page.evaluate(() => navigator.clipboard.writeText('right click paste'));
  await screen.click({ button: 'right' });
  await pane.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(() => inputs.join('')).toContain('right click paste');

  await page.evaluate(async () => navigator.clipboard.write([
    new ClipboardItem({ 'text/html': new Blob(['<p>menu first</p><p>menu second</p>'], { type: 'text/html' }) }),
  ]));
  await screen.click({ button: 'right' });
  await pane.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(() => inputs.join('')).toContain('menu first\rmenu second');

  // Windows clipboard providers can include an image preview with HTML text
  // while omitting text/plain, which xterm normally reads for paste.
  await pane.locator('.xterm-helper-textarea').evaluate(element => {
    const payload = new DataTransfer();
    payload.setData('text/html', '<p>rich CLI first<br>rich CLI second</p><img src="cid:preview">');
    payload.items.add(new File(['image bytes'], 'preview.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload }));
  });
  await expect.poll(() => inputs.join('')).toContain('rich CLI first\rrich CLI second');

  const beforeImage = inputs.join('');
  await pane.locator('.xterm-helper-textarea').evaluate(element => {
    const payload = new DataTransfer();
    payload.items.add(new File(['image bytes'], 'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload }));
  });
  await expect(pane.getByRole('alert')).toContainText('clipboard contains an image but no text');
  expect(inputs.join('')).toBe(beforeImage);
});

test('restores CLI input focus and opens terminal file references in the code tree', async ({ page }) => {
  await page.route('**/api/workspace/feature-x/changes?include=all', route => route.fulfill({ json: { changes: [{ repoName: 'repo', repoPath: 'C:/repo', files: [{ file: 'src/nested/clean.ts', type: 'unchanged' }] }] } }));
  await page.route('**/api/workspace/feature-x/changes/diff?*', route => route.fulfill({ json: { diff: '', fileContent: 'export const clean = true;\n' } }));
  await page.routeWebSocket('**/ws/terminal', socket => {
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type !== 'attach') return;
      socket.send(JSON.stringify({ type: 'ready', terminal, truncated: false }));
      socket.send(JSON.stringify({ type: 'output', data: 'src/nested/clean.ts:12\r\nsrc/missing.ts:9\r\n' }));
      socket.send(JSON.stringify({ type: 'replayed' }));
    });
  });
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  const pane = chat.getByTestId('terminal-pane');
  await expect(pane.getByRole('status')).toContainText('Connected');
  await chat.getByRole('button', { name: 'Chat', exact: true }).click();
  await chat.getByRole('button', { name: 'CLI', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))).toBe(true);

  const screen = pane.locator('.xterm-screen');
  const clickOutputRow = async (index: number) => {
    const cell = await screen.evaluate((element, rowIndex) => {
      const bounds = element.getBoundingClientRect();
      const firstRow = element.querySelector('.xterm-rows')?.firstElementChild?.getBoundingClientRect();
      const rowHeight = firstRow?.height ?? 17;
      return { x: bounds.x + 35, y: (firstRow?.y ?? bounds.y) + rowHeight * (rowIndex + 0.5) };
    }, index);
    await page.mouse.move(cell.x, cell.y);
    await page.mouse.click(cell.x, cell.y);
  };
  await clickOutputRow(0);
  const code = chat.getByRole('region', { name: 'Workspace code' });
  await expect(code.getByText('repo/src/nested/clean.ts:12')).toBeVisible();
  await expect(code.getByText('export const clean = true;')).toBeVisible();
  await clickOutputRow(1);
  await expect(code.getByRole('alert')).toContainText('not in this workspace');
  await clickOutputRow(0);
  await expect(code.getByText('repo/src/nested/clean.ts:12')).toBeVisible();
  await expect(code.getByRole('alert')).toHaveCount(0);
  await chat.getByRole('button', { name: 'Chat', exact: true }).click();
  await chat.getByRole('button', { name: 'CLI', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))).toBe(true);
});

test('opens a path even when narrowing the terminal wraps it across rows', async ({ page }) => {
  const longPath = 'src/nested/really-long-folder-name/target.ts';
  await page.route('**/api/workspace/feature-x/changes?include=all', route => route.fulfill({ json: { changes: [{ repoName: 'repo', repoPath: 'C:/repo', files: [{ file: 'src/nested/clean.ts', type: 'unchanged' }, { file: longPath, type: 'unchanged' }] }] } }));
  await page.route('**/api/workspace/feature-x/changes/diff?*', route => route.fulfill({ json: { diff: '', fileContent: 'export const target = true;\n' } }));
  await page.routeWebSocket('**/ws/terminal', socket => {
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type !== 'attach') return;
      socket.send(JSON.stringify({ type: 'ready', terminal, truncated: false }));
      socket.send(JSON.stringify({ type: 'output', data: `src/nested/clean.ts\r\n${longPath}:42\r\n` }));
      socket.send(JSON.stringify({ type: 'replayed' }));
    });
  });
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  const pane = chat.getByTestId('terminal-pane');
  await expect(pane.getByRole('status')).toContainText('Connected');
  const screen = pane.locator('.xterm-screen');
  const clickRow = async (row: number) => {
    const cell = await screen.evaluate((element, index) => {
      const bounds = element.getBoundingClientRect();
      const height = element.querySelector('.xterm-rows')?.firstElementChild?.getBoundingClientRect().height ?? 17;
      return { x: bounds.x + 30, y: bounds.y + height * (index + 0.5) };
    }, row);
    await page.mouse.move(cell.x, cell.y);
    await page.mouse.click(cell.x, cell.y);
  };
  await clickRow(0);
  const code = chat.getByRole('region', { name: 'Workspace code' });
  await expect(code.getByText('repo/src/nested/clean.ts')).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Resume session' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => screen.evaluate(element => element.clientHeight)).toBeGreaterThan(100);
  await expect.poll(() => screen.evaluate(element => element.clientWidth)).toBeLessThan(400);
  await clickRow(1);
  await expect(code.getByText(`repo/${longPath}:42`)).toBeVisible();
});
