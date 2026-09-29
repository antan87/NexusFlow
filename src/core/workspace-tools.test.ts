import { afterEach, beforeEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { parse } from 'smol-toml';
import { BRAND_CONFIG } from './constants.js';
import { generateWorkspaceTools, CLI_LAUNCHER, CLI_ALIAS_LAUNCHER, LAUNCHER_MARKER, launcherCommandPath, generatedLauncher, currentCliRuntime } from './workspace-tools.js';
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-tools-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const runtime = { command: process.execPath, entry: path.resolve('dist/index.js') };
it('provides an executable local CLI and selected-assistant MCP configs without npx', async () => {
  const outputs = await generateWorkspaceTools(root, ['claude', 'codex', 'copilot', 'antigravity'], runtime);
  expect(outputs).not.toContain('.cursor/mcp.json');
  expect((await (process.platform === 'win32' ? execa('cmd.exe', ['/d', '/c', path.join(root, `${CLI_LAUNCHER}.cmd`), 'isolate', '--help']) : execa(path.join(root, CLI_LAUNCHER), ['isolate', '--help']))).stdout).toContain('isolate');
  expect((await (process.platform === 'win32' ? execa('cmd.exe', ['/d', '/c', path.join(root, `${CLI_ALIAS_LAUNCHER}.cmd`), '--version']) : execa(path.join(root, CLI_ALIAS_LAUNCHER), ['--version']))).stdout).toMatch(/\d+\.\d+\.\d+/);
  for (const file of ['.mcp.json', '.vscode/mcp.json']) {
    const config = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
    const server = (config.mcpServers ?? config.servers)[BRAND_CONFIG.mcp.serverName];
    // The launcher, not the raw runtime: a desktop install's exec path is a
    // temporary AppImage extraction that dies on reboot.
    expect(server).toMatchObject({ command: launcherCommandPath(root), args: ['mcp', 'run', root, '--role', 'interactive'] });
  }
  const codex = parse(await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8'));
  expect(codex.mcp_servers).toHaveProperty(BRAND_CONFIG.mcp.serverName);
  expect(codex.mcp_servers[BRAND_CONFIG.mcp.serverName]).toMatchObject({ command: launcherCommandPath(root) });
});

it('resolves the desktop runtime at call time instead of trusting a stale extraction', async () => {
  // Layout of one AppImage extraction, as the desktop app creates it.
  const extraction = path.join(root, 'appimage_extracted_deadbeef');
  const bin = path.join(extraction, 'contextspace-desktop');
  const entry = path.join(extraction, 'resources', 'backend', 'dist', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  // Stands in for the Electron-as-node host: echoes the entry it was handed.
  await fs.writeFile(bin, '#!/bin/sh\necho "backend $1"\n');
  await fs.chmod(bin, 0o755);
  await fs.writeFile(entry, '// packaged backend\n');
  await generateWorkspaceTools(root, ['claude'], { command: bin, entry, electron: true });

  const launcher = path.join(root, CLI_LAUNCHER);
  const content = await fs.readFile(launcher, 'utf8');
  expect(content).toContain('ELECTRON_RUN_AS_NODE=1');
  expect(content).toContain('appimage_extracted_');

  // Recorded paths still work while the extraction they name is intact.
  expect((await execa(launcher, [])).stdout).toContain(`backend ${entry}`);

  // The extraction is gone — as after a reboot or an app update. A second
  // extraction stands ready, as re-launching the app would leave.
  const fresh = path.join(root, 'appimage_extracted_feedface');
  const freshBin = path.join(fresh, 'contextspace-desktop');
  const freshEntry = path.join(fresh, 'resources', 'backend', 'dist', 'index.js');
  await fs.mkdir(path.dirname(freshEntry), { recursive: true });
  await fs.writeFile(freshBin, '#!/bin/sh\necho "fresh backend $1"\n');
  await fs.chmod(freshBin, 0o755);
  await fs.writeFile(freshEntry, '// packaged backend\n');
  await fs.utimes(fresh, new Date(), new Date());
  await fs.rm(extraction, { recursive: true, force: true });

  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'no-extraction-'));
  const saved = process.env.TMPDIR;
  try {
    // The fresh extraction lives in the workspace, so point TMPDIR at its parent.
    process.env.TMPDIR = root;
    expect((await execa(launcher, [])).stdout).toContain(`fresh backend ${freshEntry}`);

    // Nothing to fall back on: say what to do instead of "no such file".
    process.env.TMPDIR = empty;
    await expect(execa(launcher, [])).rejects.toThrow(/desktop runtime is unavailable/);
    await expect(execa(launcher, [])).rejects.toThrow(/Launch the ContextSpace desktop app once/);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    await fs.rm(empty, { recursive: true, force: true });
  }
});

it('records the process runtime verbatim for an npm install', () => {
  // No AppImage indirection: `process.execPath` is already stable here, and the
  // AppImage is not a node host (it ignores ELECTRON_RUN_AS_NODE).
  expect(currentCliRuntime().command).toBe(process.execPath);
  expect(currentCliRuntime().electron).toBe(Boolean(process.versions.electron));
});

it('refuses to reuse a launcher the user replaced', async () => {
  await fs.mkdir(path.dirname(path.join(root, CLI_LAUNCHER)), { recursive: true });
  await fs.writeFile(path.join(root, CLI_LAUNCHER), '#!/bin/sh\nexec my-own-cli "$@"\n');
  expect(generatedLauncher(root)).toBeUndefined();
  await fs.writeFile(path.join(root, CLI_LAUNCHER), `#!/bin/sh\n# ${LAUNCHER_MARKER}\nexec ctxspace "$@"\n`);
  expect(generatedLauncher(root)).toBe(path.join(root, CLI_LAUNCHER));
});
it('preserves unrelated MCP settings across repeat generation and supports the desktop runtime', async () => {
  await fs.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ custom: true, mcpServers: { other: { command: 'other' } } }));
  await fs.mkdir(path.join(root, '.codex'));
  await fs.writeFile(path.join(root, '.codex/config.toml'), 'model = "custom"\n[mcp_servers.other]\ncommand = "other"\n');
  const desktop = { ...runtime, electron: true };
  await generateWorkspaceTools(root, ['claude', 'codex'], desktop);
  const before = await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8');
  await generateWorkspaceTools(root, ['claude', 'codex'], desktop);
  expect(await fs.readFile(path.join(root, '.codex/config.toml'), 'utf8')).toBe(before);
  expect(parse(before)).toMatchObject({ model: 'custom', mcp_servers: { other: { command: 'other' }, [BRAND_CONFIG.mcp.serverName]: { command: launcherCommandPath(root) } } });
  expect(JSON.parse(await fs.readFile(path.join(root, '.mcp.json'), 'utf8'))).toMatchObject({ custom: true, mcpServers: { other: { command: 'other' } } });
  expect(await fs.readFile(path.join(root, `${CLI_LAUNCHER}.cmd`), 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1');
});
it('rejects malformed configs and custom launchers instead of overwriting them', async () => {
  await fs.writeFile(path.join(root, '.mcp.json'), '{broken');
  await expect(generateWorkspaceTools(root, ['claude'], runtime)).rejects.toThrow();
  expect(await fs.readFile(path.join(root, '.mcp.json'), 'utf8')).toBe('{broken');
  await fs.writeFile(path.join(root, CLI_LAUNCHER), 'custom');
  await expect(generateWorkspaceTools(root, [], runtime)).rejects.toThrow('custom launcher');
});
it.skipIf(process.platform === 'win32')('rejects a linked config directory without writing outside the workspace', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-outside-'));
  try {
    await fs.symlink(outside, path.join(root, '.codex'));
    await expect(generateWorkspaceTools(root, ['codex'], runtime)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
});

it('removes only the legacy generated Cursor entry when Cursor is unselected', async () => {
  const target = path.join(root, '.cursor/mcp.json');
  await fs.mkdir(path.dirname(target));
  const legacy = { command: 'npx', args: ['-y', BRAND_CONFIG.mcp.packageName, 'mcp', 'run'] };
  await fs.writeFile(target, JSON.stringify({ mcpServers: { [BRAND_CONFIG.mcp.serverName]: legacy, other: { command: 'custom' } } }));
  await generateWorkspaceTools(root, ['claude'], runtime);
  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ mcpServers: { other: { command: 'custom' } } });
  await fs.writeFile(target, JSON.stringify({ mcpServers: { [BRAND_CONFIG.mcp.serverName]: legacy } }));
  await generateWorkspaceTools(root, [], runtime);
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
});
