import { describe, expect, it } from 'vitest';
import { resolveLaunch, terminalEnvironment } from './targets.js';

describe('interactive terminal targets', () => {
  it('rejects raw commands, unsupported targets and invalid resume IDs', () => {
    expect(() => resolveLaunch('sh -c echo injected')).toThrow('target');
    expect(() => resolveLaunch('shell', 'session')).toThrow('saved');
  });
  it('does not leak Electron-as-Node or injected Node options to the harness', () => {
    const env = terminalEnvironment(); expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined(); expect(env.NODE_OPTIONS).toBeUndefined(); expect(env.TERM).toBe('xterm-256color'); expect(env.PATH).toBeTruthy();
  });
});
