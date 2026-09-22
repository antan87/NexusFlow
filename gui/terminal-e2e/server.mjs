import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real backend and PTY, isolated from the developer's ContextSpace data.
const root = await mkdtemp(path.join(tmpdir(), 'contextspace-terminal-e2e-'));
// Set both brand aliases so the fixture remains isolated even on Windows,
// where a pre-existing runner environment can otherwise make the config
// resolver fall back to the user's real home directory.
const configHome = path.resolve(root, 'config');
process.env.CONTEXTSPACE_HOME = configHome;
process.env.NEXUSFLOW_HOME = configHome;
const workspace = path.join(root, 'workspaces', 'terminal-test');
await mkdir(workspace, { recursive: true });
await mkdir(configHome, { recursive: true });
await writeFile(path.join(configHome, 'config.json'), JSON.stringify({ version: '1.0.0', devDir: root, workspacesDir: path.dirname(workspace), storageProvider: 'local' }));
await writeFile(path.join(workspace, 'contextspace.json'), JSON.stringify({ id: 'terminal-test', branchName: 'terminal-test', description: 'Isolated native terminal test', workspacePath: workspace, repos: [], assistants: [], createdAt: new Date().toISOString() }));
const other = path.join(root, 'workspaces', 'terminal-other');
await mkdir(other);
await writeFile(path.join(other, 'contextspace.json'), JSON.stringify({ id: 'terminal-other', branchName: 'terminal-other', workspacePath: other, repos: [], assistants: [], createdAt: new Date().toISOString() }));
const { startServer } = await import('../../dist/server.js');
await startServer(4187, { strictPort: true });
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
