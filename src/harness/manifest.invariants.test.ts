import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_HARNESSES,
  HARNESSES,
  HARNESS_LIST,
  HISTORY_HARNESSES,
  isAssistantHarnessId,
  isHarnessId,
  mcpTargetsFor,
  skillRootsFor,
} from './manifest.js';
import { AIAssistant, SessionAssistant } from '../types.js';
import { CLI_HARNESSES, SESSION_SOURCES, isCliHarnessId } from '../utils/cli-harnesses.js';

/**
 * The manifest is only worth having if every consumer is derived from it, and it
 * is only safe if a half-declared harness fails loudly. These tests are the
 * enforcement: an entry in `HARNESSES` that no consumer wires up is a defect,
 * not a TODO. This is the test pi would have failed.
 */
describe('Harness manifest invariants', () => {
  it('declares unique ids that match their keys', () => {
    const ids = HARNESS_LIST.map((harness) => harness.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const harness of HARNESS_LIST) {
      expect(isHarnessId(harness.id)).toBe(true);
      expect(getByKey(harness.id)).toBe(harness);
    }
  });

  it('rejects unknown ids and accepts every declared one', () => {
    for (const harness of HARNESS_LIST) expect(isHarnessId(harness.id)).toBe(true);
    expect(isHarnessId('grok')).toBe(false);
    expect(isHarnessId('')).toBe(false);
    expect(isHarnessId(null)).toBe(false);
    expect(isHarnessId({})).toBe(false);
  });

  it('keeps the assistant role and the session-only role disjoint and complete', () => {
    const assistants = ASSISTANT_HARNESSES.filter(isAssistantHarnessId);
    const others = HARNESS_LIST.map((h) => h.id).filter((id) => !isAssistantHarnessId(id));
    expect(new Set([...assistants, ...others]).size).toBe(HARNESS_LIST.length);
    for (const id of others) expect(isAssistantHarnessId(id)).toBe(false);
  });

  it('derives a terminal entry for every harness, with a working launch binary', () => {
    for (const harness of HARNESS_LIST) {
      const cli = CLI_HARNESSES[harness.id];
      expect(cli, `${harness.id} has no CLI_HARNESSES entry`).toBeDefined();
      expect(cli.name).toBe(harness.label);
      // A launch binary is what terminal launch and session resume both need.
      expect(cli.binary).toBe(harness.detection.launchCommand ?? harness.detection.probe);
      expect(cli.history).toBe(harness.terminal.history);
      expect(cli.resumeArgs('session-id')).toEqual(harness.terminal.resumeArgs('session-id'));
    }
    expect(Object.keys(CLI_HARNESSES).sort()).toEqual(HARNESS_LIST.map((h) => h.id).sort());
  });

  it('agrees with the session source list about which harnesses have history', () => {
    for (const id of HISTORY_HARNESSES) expect(SESSION_SOURCES).toContain(id);
    for (const source of SESSION_SOURCES) {
      if (source === 'workspace') continue;
      expect(HISTORY_HARNESSES).toContain(source);
      expect(isCliHarnessId(source)).toBe(true);
    }
  });

  it('gives every harness a detection probe and a context strategy', () => {
    for (const harness of HARNESS_LIST) {
      expect(harness.detection.probe, `${harness.id} has no probe`).toBeTruthy();
      // A launch probe without a launch command would probe a binary nothing runs.
      if (harness.detection.launchProbe) {
        expect(harness.detection.launchCommand, `${harness.id} probes a launch binary it never runs`).toBeTruthy();
      }
      expect(['native-agents-md', 'import', 'own-file']).toContain(harness.context.kind);
      if (harness.context.kind !== 'native-agents-md') expect(harness.context.path).toBeTruthy();
    }
  });

  it('materializes a portable skill root once, however many harnesses declare it', () => {
    // codex and cursor are both portable: one shared root, not two copies.
    expect(skillRootsFor(['codex', 'cursor']).map((root) => root.root)).toEqual(['.agents/skills']);
    expect(skillRootsFor(['claude']).map((root) => root.root)).toEqual(['.claude/skills']);
    expect(skillRootsFor(['claude', 'codex']).map((root) => root.root)).toEqual(['.claude/skills', '.agents/skills']);
    expect(skillRootsFor([])).toEqual([]);
    expect(skillRootsFor(['not-a-harness'])).toEqual([]);
  });

  it('writes an MCP config at most once per path, and none for a user-level harness', () => {
    // claude and copilot share the root .mcp.json.
    const paths = mcpTargetsFor(['claude', 'copilot', 'cursor', 'codex', 'antigravity']).map((target) => target.path);
    expect(paths).toEqual([...new Set(paths)]);
    expect(paths).toContain('.mcp.json');
    expect(paths).toContain('.codex/config.toml');
    // Antigravity reads a user-level config; refresh must not write it.
    expect(mcpTargetsFor(['antigravity'])).toEqual([]);
  });

  it('gives every MCP target a format the writer can serialise', () => {
    for (const harness of HARNESS_LIST) {
      for (const target of harness.mcp ?? []) {
        expect(['json', 'toml'], `${target.path} format`).toContain(target.format);
        expect(target.key, `${target.path} key`).toBeTruthy();
        // Only the vscode-style table needs an explicit stdio type.
        if (target.key !== 'servers') expect(target.entryType).toBeUndefined();
      }
    }
  });

  it('keeps the derived assistant type in step with the manifest role', () => {
    // Deliberately explicit about pi: it is launchable and resumable but not an
    // assistant, so it is absent from AIAssistant. Promoting it to `assistant`
    // (milestone M2) must break this test on purpose, so the promotion is a
    // reviewed change rather than a silent one.
    const derived: readonly AIAssistant[] = ASSISTANT_HARNESSES;
    expect(derived).not.toContain('pi');
    expect(derived).toHaveLength(ASSISTANT_HARNESSES.length);
    expect(HARNESSES.pi.role).toBe('session-only');
    // Every harness id is a valid SessionAssistant, so history can name pi.
    const sessions: readonly SessionAssistant[] = HARNESS_LIST.map((harness) => harness.id);
    expect(sessions).toContain('pi');
  });

  it('records a vendor only for a harness the normalized layer can drive', () => {
    const withVendor = HARNESS_LIST.filter((harness) => harness.vendor);
    // One vendor per harness: two harnesses sharing one vendor would normalize
    // two different session formats into the same identity.
    expect(new Set(withVendor.map((harness) => harness.vendor)).size).toBe(withVendor.length);
    for (const harness of withVendor) {
      expect(harness.terminal.resumeArgs('x').length, `${harness.id} has a vendor but cannot resume`).toBeGreaterThan(0);
      expect(harness.terminal.history, `${harness.id} has a vendor but no saved sessions`).toBe(true);
    }
  });
});

function getByKey(id: string) {
  return (HARNESSES as Record<string, unknown>)[id];
}
