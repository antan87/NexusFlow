import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getLocalCliEntry, getLocalMcpServerConfig } from './mcp-config.js';
import { CLI_LAUNCHER, LAUNCHER_MARKER, launcherCommandPath } from '../core/workspace-tools.js';

function withWorkspace<T>(body: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-'));
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('Local MCP Server Config Helper', () => {
  it('resolves the local CLI entry path', () => {
    const entry = getLocalCliEntry();
    expect(entry).toContain('dist');
    expect(entry.endsWith('index.js')).toBe(true);
  });
  it('runs the workspace launcher when one was generated, so no ephemeral runtime path is embedded', () => {
    withWorkspace((root) => {
      const fallback = process.execPath;
      expect(getLocalMcpServerConfig(root, 'developer').command).toBe(fallback);

      const launcher = launcherCommandPath(root);
      fs.mkdirSync(path.dirname(launcher), { recursive: true });
      fs.writeFileSync(launcher, `#!/bin/sh\n# ${LAUNCHER_MARKER}\nexec ctxspace "$@"\n`);
      const config = getLocalMcpServerConfig(root, 'review');
      expect(config).toEqual({ command: launcher, args: ['mcp', 'run', root, '--role', 'review'] });

      // A launcher the user replaced is not ours to invoke.
      fs.writeFileSync(launcher, '#!/bin/sh\nexec my-own-cli "$@"\n');
      expect(getLocalMcpServerConfig(root).command).toBe(fallback);
    });
  });

  it('throws helpful remediation error when dist/index.js is missing', () => {
    expect(() => getLocalCliEntry('/non/existent/dist/index.js')).toThrow(/Run "npm run build" to compile/);
  });
});
