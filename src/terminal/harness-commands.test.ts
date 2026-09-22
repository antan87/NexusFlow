import { describe, expect, it, vi } from 'vitest';
import { resolveLaunch } from './targets.js';

vi.mock('../utils/user-paths.js', () => ({ getAugmentedPath: () => '/fixture', findExecutable: (name: string) => `/fixture/${name}` }));
describe('interactive harness resume commands', () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  it.each([
    ['codex', 'codex', ['resume', id]], ['claude', 'claude', ['--resume', id]],
    ['antigravity', 'agy', ['--conversation', id]], ['copilot', 'copilot', ['--resume', id]],
    ['cursor', 'agent', ['--resume', id]], ['pi', 'pi', ['--session', id]],
  ])('passes %s its own session arguments', (target, binary, args) => {
    expect(resolveLaunch(target as string, id, {}, 'linux')).toMatchObject({ file: `/fixture/${binary}`, args });
  });
  it('does not accept shell syntax or incomplete IDs as saved sessions', () => {
    expect(() => resolveLaunch('antigravity', 'id; echo unsafe', {}, 'linux')).toThrow('Invalid');
    expect(() => resolveLaunch('copilot', 'short', {}, 'linux')).toThrow('Invalid');
  });
});
