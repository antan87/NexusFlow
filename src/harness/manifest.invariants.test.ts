import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_HARNESSES,
  getHarness,
  isHarnessConfigured,
  launchCommandFor,
  HARNESSES,
  HARNESS_LIST,
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
    expect(isHarnessId('gemini-cli')).toBe(false);
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

  it('gives every launchable harness a terminal entry, and no entry to a credential-only one', () => {
    for (const harness of HARNESS_LIST) {
      if (!harness.terminal) {
        // No local binary means no terminal target: offering one would produce a
        // launcher that can never start.
        expect(isCliHarnessId(harness.id)).toBe(false);
        expect(CLI_HARNESSES).not.toHaveProperty(harness.id);
        continue;
      }
      const cli = CLI_HARNESSES[harness.id];
      expect(cli, `${harness.id} has no CLI_HARNESSES entry`).toBeDefined();
      expect(cli.name).toBe(harness.label);
      // A launch binary is what terminal launch and session resume both need.
      expect(cli.binary).toBe(harness.detection.launchCommand ?? harness.detection.probe);
      expect(cli.history).toBe(harness.terminal.history);
      expect(cli.resumeArgs('session-id')).toEqual(harness.terminal.resumeArgs('session-id'));
    }
    expect(Object.keys(CLI_HARNESSES).sort()).toEqual(HARNESS_LIST.filter((h) => h.terminal).map((h) => h.id).sort());
  });

  it('separates credential-only harnesses from installable ones', () => {
    for (const harness of HARNESS_LIST) {
      if (harness.detection.kind === 'binary') {
        expect(harness.detection.probe, `${harness.id} has no probe`).toBeTruthy();
        // A launch probe without a launch command would probe a binary nothing runs.
        if (harness.detection.launchProbe) {
          expect(harness.detection.launchCommand, `${harness.id} probes a launch binary it never runs`).toBeTruthy();
        }
        continue;
      }
      // A credential-only harness must not claim a binary, and must name the
      // variable that configures it plus what to tell the user when it is unset.
      expect(harness.detection.env.length, `${harness.id} names no credential`).toBeGreaterThan(0);
      expect(harness.detection.missingMessage).toBeTruthy();
      expect(harness.terminal, `${harness.id} is credential-only but declares sessions`).toBeUndefined();
      expect(isHarnessConfigured(harness, () => true), `${harness.id} ignores its credential`).toBe(false);
    }
  });

  it('keeps grok a full assistant that needs no local binary', () => {
    const grok = getHarness('grok')!;
    expect(grok.role).toBe('assistant');
    expect(grok.detection.kind).toBe('api-key');
    expect(grok.skills.map((root) => root.root)).toContain('.agents/skills');
    expect(grok.mcp?.map((target) => target.path)).toContain('.mcp.json');
    expect(grok.chatProviderIds).toContain('grok-native');
    // Nothing launchable, and nothing that claims to be.
    expect(launchCommandFor(grok)).toBeUndefined();
    expect(isCliHarnessId('grok')).toBe(false);
    expect(ASSISTANT_HARNESSES).toContain('grok');
  });

  it('agrees with the session source list about which harnesses have history', () => {
    const history = HARNESS_LIST.filter((harness) => harness.terminal?.history).map((harness) => harness.id);
    for (const id of history) expect(SESSION_SOURCES).toContain(id);
    for (const source of SESSION_SOURCES) {
      if (source === 'workspace') continue;
      expect(history).toContain(source);
      expect(isCliHarnessId(source)).toBe(true);
    }
  });

  it('gives every harness a context strategy', () => {
    for (const harness of HARNESS_LIST) {
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
    // pi is an assistant as of M2. It was deliberately the one session-only
    // harness before that, and this assertion is why the promotion had to be a
    // reviewed change: flipping the role fails here rather than silently
    // changing what the picker and the config schema accept.
    const derived: readonly AIAssistant[] = ASSISTANT_HARNESSES;
    expect(derived).toContain('pi');
    expect(HARNESSES.pi.role).toBe('assistant');
    expect(derived).toHaveLength(ASSISTANT_HARNESSES.length);
    // Every harness id is a valid SessionAssistant, so history can name pi.
    const sessions: readonly SessionAssistant[] = HARNESS_LIST.map((harness) => harness.id);
    expect(sessions).toContain('pi');
  });

  it('declares the MCP client pi needs, rather than leaving it tribal knowledge', () => {
    // pi writes no MCP config of its own and reads none by default: the binary
    // has no MCP client, so a generated `.mcp.json` only reaches it through an
    // extension. That is the reason the pi harness was invisible in this
    // workspace until a global config was hand-written.
    expect(HARNESSES.pi.mcp?.map((target) => target.path)).toContain('.mcp.json');
    expect(HARNESSES.pi.mcpViaExtension).toBe('pi-mcp-adapter');
    // Every other assistant reads MCP config natively.
    for (const harness of HARNESS_LIST) {
      if (harness.id === 'pi' || !(harness.mcp ?? []).length) continue;
      expect(harness.mcpViaExtension, `${harness.id} should not need an MCP extension`).toBeUndefined();
    }
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
