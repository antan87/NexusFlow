import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { getLocalCliEntry, getLocalMcpServerConfig } from './mcp-config.js';

describe('Local MCP Server Config Helper', () => {
  it('resolves the local CLI entry path', () => {
    const entry = getLocalCliEntry();
    expect(entry).toContain('dist');
    expect(entry.endsWith('index.js')).toBe(true);
  });

  it('builds a local MCP configuration with node executable and role flag', () => {
    const config = getLocalMcpServerConfig('/workspace/path', 'developer');
    expect(config.command).toBe(process.execPath);
    expect(config.args).toContain('mcp');
    expect(config.args).toContain('run');
    expect(config.args).toContain('/workspace/path');
    expect(config.args).toContain('--role');
    expect(config.args).toContain('developer');
  });

  it('throws helpful remediation error when dist/index.js is missing', () => {
    expect(() => getLocalCliEntry('/non/existent/dist/index.js')).toThrow(/Run "npm run build" to compile/);
  });
});
