import { test, expect } from './fixtures';

const workspace = { id: 'feature-x', branchName: 'feature-x', description: 'Image chat', repos: [], assistants: ['codex'], workspacePath: 'C:/ws/feature-x', createdAt: '2026-09-20T00:00:00Z' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
test.use({ workspacesData: [workspace] });

test('keeps an image and text when first-turn upload fails, then sends both on retry', async ({ page }) => {
  await page.route('**/api/adapters/status', route => route.fulfill({ json: [{
    id: 'codex-cli', name: 'Codex (Local CLI)', isConfigured: true,
    executionProfiles: [{ id: 'review', label: 'Review only', description: 'Reads and plans.' }],
    defaultExecutionProfile: 'review',
    capabilities: { transport: 'cli-print', sessionIdentity: 'provider-assigned', workspaceAccess: 'harness-managed', sessionIdFormat: 'uuid' },
  }] }));
  let attempts = 0;
  await page.route('**/api/chat/upload-attachment', route => {
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: 'Temporary storage failure' } }
      : { json: { path: 'C:/ws/feature-x/.nexusflow/attachments/image.png' } });
  });
  const frames: Array<Record<string, unknown>> = [];
  await page.routeWebSocket('**/ws', socket => socket.onMessage(message => frames.push(JSON.parse(String(message)))));
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  await chat.getByRole('button', { name: 'Chat', exact: true }).click();
  await chat.getByPlaceholder('Start the agent or press Enter...').fill('What is in this image?');
  await chat.locator('input[type=file]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  await expect(chat.getByAltText('image.png')).toBeVisible();
  await chat.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(chat.getByText(/Temporary storage failure/)).toBeVisible();
  await expect(chat.getByPlaceholder(/Message the agent/)).toHaveValue('What is in this image?');
  await expect(chat.getByAltText('image.png')).toBeVisible();
  expect(frames.filter(frame => frame.type === 'input')).toHaveLength(0);
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => frames.filter(frame => frame.type === 'input').length).toBe(1);
  expect(String(frames.find(frame => frame.type === 'input')?.input)).toContain('[Attached image: C:/ws/feature-x/.nexusflow/attachments/image.png]');
  await expect(chat.getByPlaceholder(/Message the agent/)).toHaveValue('');
});

test('pastes text normally when the clipboard also advertises an image', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  await chat.getByRole('button', { name: 'Chat', exact: true }).click();
  const composer = chat.getByPlaceholder('Start the agent or press Enter...');
  await page.evaluate(() => navigator.clipboard.writeText('ordinary copied text'));
  await composer.focus();
  await composer.press('ControlOrMeta+v');
  await expect(composer).toHaveValue('ordinary copied text');

  const prevented = await composer.evaluate(element => {
    const payload = new DataTransfer();
    payload.setData('text/plain', 'copied text');
    payload.items.add(new File(['image bytes'], 'clipboard.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(chat.getByAltText('clipboard.png')).toHaveCount(0);

  await composer.evaluate(element => {
    const payload = new DataTransfer();
    payload.setData('text/html', '<p>fallback rich text</p><img src="cid:preview">');
    payload.items.add(new File(['image bytes'], 'preview.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload }));
  });
  await expect(composer).toHaveValue('ordinary copied textfallback rich text');
  await expect(chat.getByAltText('preview.png')).toHaveCount(0);

  await composer.evaluate(element => {
    const payload = new DataTransfer();
    payload.setData('text/html', '<p>first line</p><p>second line</p>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: payload }));
  });
  await expect(composer).toHaveValue('ordinary copied textfallback rich textfirst line\nsecond line');
});
