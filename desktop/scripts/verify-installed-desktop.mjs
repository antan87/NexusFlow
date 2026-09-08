// Companion to verify-windows-upgrade.ps1. Drives the installed executable, not
// the unpacked packaging output, before and after the real NSIS upgrade.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const [phase, executablePath, fixtureRoot, expectedVersion] = process.argv.slice(2);
assert.ok(phase === 'before' || phase === 'after', 'Expected before/after phase');
assert.ok(executablePath && fixtureRoot && expectedVersion, 'Missing upgrade fixture arguments');
const configHome = path.join(fixtureRoot, 'config');
const workspacePath = path.join(fixtureRoot, 'workspaces', 'upgrade-fixture');
const statePath = path.join(fixtureRoot, 'before.json');
const knowledge = '# Upgrade fixture\n\nKeep this workspace decision through the upgrade.\n';
if (phase === 'before') {
  await mkdir(configHome, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await mkdir(path.join(fixtureRoot, 'dev'), { recursive: true });
  await writeFile(path.join(configHome, 'config.json'), JSON.stringify({
    version: '1.0.0', devDir: path.join(fixtureRoot, 'dev'),
    workspacesDir: path.dirname(workspacePath), defaultAssistant: null,
    scanDepth: 2, excludePatterns: [], storageProvider: 'local',
  }));
  await writeFile(path.join(workspacePath, 'nexusflow.json'), JSON.stringify({
    id: 'upgrade-fixture', branchName: 'upgrade-fixture', mode: 'in-place',
    description: 'Existing workspace upgrade acceptance', repos: [], assistants: [],
    workspacePath, createdAt: new Date().toISOString(),
  }));
  await writeFile(path.join(workspacePath, 'nexusflow-knowledge.md'), knowledge);
}

const app = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    CONTEXTSPACE_HOME: configHome, NEXUSFLOW_HOME: configHome,
    CONTEXTSPACE_DESKTOP_LOG: path.join(fixtureRoot, `${phase}-desktop.log`),
    NEXUSFLOW_DESKTOP_LOG: path.join(fixtureRoot, `${phase}-desktop.log`),
  },
  timeout: 60000,
});
try {
  const window = await app.firstWindow();
  await window.waitForURL(/http:\/\/localhost:\d+/, { timeout: 60000 });
  const identity = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData') }));
  assert.equal(identity.version, expectedVersion);
  const workspaces = await window.evaluate(async () => {
    const response = await fetch('/api/workspaces');
    if (!response.ok) throw new Error(`Workspace request failed: ${response.status}`);
    return response.json();
  });
  assert.ok(workspaces.some((workspace) => workspace.branchName === 'upgrade-fixture'), 'Existing workspace must remain discoverable');
  assert.equal(await readFile(path.join(workspacePath, 'nexusflow-knowledge.md'), 'utf8'), knowledge);
  const markerPath = path.join(identity.userData, 'upgrade-acceptance.json');
  if (phase === 'before') {
    await writeFile(markerPath, JSON.stringify({ retained: true }));
    await app.evaluate(async ({ session }, url) => {
      await session.defaultSession.cookies.set({ url, name: 'upgrade_acceptance', value: 'retained', expirationDate: Date.now() / 1000 + 86400 });
      await session.defaultSession.cookies.flushStore();
    }, window.url());
    await writeFile(statePath, JSON.stringify(identity));
  } else {
    const before = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(identity.userData, before.userData, 'Upgrade must reuse the actual previous Electron profile');
    assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), { retained: true });
    const cookies = await app.evaluate(({ session }) => session.defaultSession.cookies.get({ name: 'upgrade_acceptance' }));
    assert.ok(cookies.some((cookie) => cookie.value === 'retained'), 'Persistent browser data must survive the upgrade');
  }
  console.log(`Installed ${identity.version} booted successfully with retained workspace at ${workspacePath}`);
} finally {
  const processId = app.process().pid;
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop shutdown timed out')), 8000); }),
    ]);
  } finally {
    clearTimeout(timer);
    try { execFileSync('taskkill', ['/pid', String(processId), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already stopped */ }
  }
}
