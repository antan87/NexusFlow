/**
 * @module harness/manifest
 * The single declarative record per AI harness.
 *
 * Everything that used to branch on a harness id — context generation, skill
 * roots, MCP config targets, CLI detection, terminal launch and session resume,
 * and the assistant union itself — is derived from this file. Adding a harness
 * means adding an entry here, not editing a dozen `if (assistants.includes(...))`
 * chains and two hand-mirrored type unions.
 *
 * Two axes, deliberately not merged:
 * - `role` decides whether a harness generates workspace resources
 *   (`assistant`) or only participates in session history and terminal launch
 *   (`session-only`). Pi is the latter today: it has saved-session support and a
 *   launchable CLI, but no generated context, skills or MCP config.
 * - `chatProviderIds` references `ProviderRegistry` ids rather than absorbing
 *   them, because the chat transport axis is genuinely orthogonal: one harness
 *   has several transports, and one transport serves several harnesses.
 *
 * This file is data only. It must stay free of imports from generators and
 * other consumers, because `types.ts` derives its assistant union from it.
 */

import type { Vendor } from './types.js';

export type HarnessRole =
  /** Generates workspace context, skills and MCP config when selected. */
  | 'assistant'
  /** Launchable and resumable, but generates no workspace resources. */
  | 'session-only';

/**
 * Where a harness reads its context.
 *
 * `native-agents-md` needs no generator: `AGENTS.md` is written unconditionally
 * by `generateContextFiles`, which is why codex and antigravity have always been
 * skipped there. Prefer this over inventing a file that only repeats AGENTS.md.
 */
export type ContextSpec =
  | { kind: 'native-agents-md' }
  /** A thin file that imports `AGENTS.md`, e.g. `CLAUDE.md`. */
  | { kind: 'import'; path: string }
  /** A harness-specific instruction file with its own generator. */
  | { kind: 'own-file'; path: string };

/**
 * A directory a harness discovers skills in.
 *
 * `portable` marks the convention-based `.agents/skills` layout: materialization
 * writes there when *any* selected harness declares it, rather than once per
 * harness, so two portable harnesses in one workspace do not duplicate a skill.
 */
export type SkillRootSpec = {
  root: string;
  adapter: 'agent-skill-v1' | 'claude-skill-v1';
  portable: boolean;
};

/** An MCP client config this harness reads. A harness may have more than one. */
export type McpTargetSpec = {
  path: string;
  /** Server table name: JSON camelCase, or TOML's `mcp_servers`. */
  key: 'mcpServers' | 'servers' | 'mcp_servers';
  format: 'json' | 'toml';
  /** vscode-style entries need an explicit stdio type; Claude-style do not. */
  entryType?: 'stdio';
};

/**
 * How a harness is found on the machine.
 *
 * The distinction is not cosmetic. A `binary` harness is installed by putting a
 * command on PATH and can host a terminal session; an `api-key` harness is
 * configured by a credential and has no local command at all, so it must not
 * appear in terminal launch or saved-session discovery. xAI's Grok is the
 * second kind: there is no Grok CLI, only an API.
 */
export type DetectionSpec =
  | {
      kind: 'binary';
      /** Binary whose `--version` decides whether the harness is offered. */
      probe: string;
      /**
       * Binary that can host an interactive terminal session. Defaults to
       * `probe`. Cursor is the case that needs both: `cursor` opens the GUI
       * editor, while `cursor-agent` is the terminal session CLI.
       */
      launchCommand?: string;
      /** Probe for the launch binary when it differs from `probe`. */
      launchProbe?: string;
    }
  | {
      kind: 'api-key';
      /** Environment variables that configure the harness, in preference order. */
      env: string[];
      /** Shown when none of them is set. */
      missingMessage: string;
    };

export type TerminalSpec = {
  /** Args to resume one saved session. */
  resumeArgs: (sessionId: string) => string[];
  /** Args to continue the most recent session. */
  continueArgs: string[];
  /** Whether saved sessions are discoverable for this harness. */
  history: boolean;
  /** Extra binaries that can host a session, e.g. Cursor's `agent`. */
  terminalBinaries?: string[];
};

export interface HarnessManifest {
  id: string;
  /**
   * Human-readable name, used for terminal launch, the GUI and the session list.
   * The binary is included when it differs from the product name, so a broken
   * install points at the command to install.
   */
  label: string;
  /**
   * Name shown in the workspace-creation picker, when it differs from `label`.
   * The picker names the product, while `label` names the installable CLI, so
   * these are genuinely two labels and not one label spelled two ways.
   */
  pickerLabel?: string;
  role: HarnessRole;
  detection: DetectionSpec;
  context: ContextSpec;
  skills: SkillRootSpec[];
  /** Omitted when the harness configures MCP at the user level instead. */
  mcp?: McpTargetSpec[];
  /**
   * Saved-session and terminal-launch support. Omitted for a harness with no
   * local binary, which can still be an assistant and a chat provider.
   */
  terminal?: TerminalSpec;
  /** Agent definition directory, when this harness supports agent files. */
  agents?: { dir: string };
  /** Set only when a normalized adapter exists in `src/harness/`. */
  vendor?: Vendor;
  /** References into `ProviderRegistry`, never inlined. */
  chatProviderIds?: string[];
}

const PORTABLE_SKILLS: SkillRootSpec = {
  root: '.agents/skills',
  adapter: 'agent-skill-v1',
  portable: true,
};

const CLAUDE_SKILLS: SkillRootSpec = {
  root: '.claude/skills',
  adapter: 'claude-skill-v1',
  portable: false,
};

/** The Claude/Copilot-style shared MCP config at the workspace root. */
const ROOT_MCP: McpTargetSpec = { path: '.mcp.json', key: 'mcpServers', format: 'json' };

export const HARNESSES = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    role: 'assistant',
  detection: { kind: 'binary', probe: 'claude', launchCommand: 'claude' },
    context: { kind: 'import', path: 'CLAUDE.md' },
    skills: [CLAUDE_SKILLS],
    mcp: [ROOT_MCP],
    terminal: { resumeArgs: (id: string) => ['--resume', id], continueArgs: ['--resume'], history: true },
    vendor: 'claude-code',
    chatProviderIds: ['claude-cli', 'claude-sdk', 'claude-native'],
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity (agy)',
    pickerLabel: 'Antigravity',
    role: 'assistant',
    detection: { kind: 'binary', probe: 'agy', launchCommand: 'agy' },
    context: { kind: 'native-agents-md' },
    skills: [PORTABLE_SKILLS],
    // Antigravity reads a user-level MCP config. Writing its global config on
    // refresh would be a side effect outside the workspace, so it gets none.
    terminal: { resumeArgs: (id: string) => ['--conversation', id], continueArgs: ['--continue'], history: true },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    pickerLabel: 'OpenAI Codex',
    role: 'assistant',
    detection: { kind: 'binary', probe: 'codex', launchCommand: 'codex' },
    context: { kind: 'native-agents-md' },
    skills: [PORTABLE_SKILLS],
    mcp: [{ path: '.codex/config.toml', key: 'mcp_servers', format: 'toml' }],
    terminal: { resumeArgs: (id: string) => ['resume', id], continueArgs: ['resume'], history: true },
    // Codex is the only harness whose agent catalog materializes toml files.
    agents: { dir: '.codex/agents' },
    vendor: 'codex',
    chatProviderIds: ['codex-cli', 'codex-sdk'],
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    role: 'assistant',
    detection: { kind: 'binary', probe: 'copilot', launchCommand: 'copilot' },
    context: { kind: 'own-file', path: '.github/copilot-instructions.md' },
    skills: [PORTABLE_SKILLS],
    mcp: [ROOT_MCP, { path: '.vscode/mcp.json', key: 'servers', format: 'json', entryType: 'stdio' }],
    terminal: { resumeArgs: (id: string) => ['--resume', id], continueArgs: ['--resume'], history: true },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor Agent',
    pickerLabel: 'Cursor',
    role: 'assistant',
    // `cursor` opens the GUI editor; `cursor-agent` is the terminal session CLI.
    detection: { kind: 'binary', probe: 'cursor', launchCommand: 'cursor-agent', launchProbe: 'cursor-agent' },
    context: { kind: 'own-file', path: '.cursor/rules/contextspace.mdc' },
    skills: [PORTABLE_SKILLS],
    mcp: [{ path: '.cursor/mcp.json', key: 'mcpServers', format: 'json' }],
    terminal: { resumeArgs: (id: string) => ['--resume', id], continueArgs: [], history: false, terminalBinaries: ['agent', 'cursor-agent'] },
  },
  pi: {
    id: 'pi',
    label: 'Pi',
    // Launchable and resumable, but generates no workspace resources yet.
    role: 'session-only',
    detection: { kind: 'binary', probe: 'pi', launchCommand: 'pi' },
    context: { kind: 'native-agents-md' },
    skills: [PORTABLE_SKILLS],
    terminal: { resumeArgs: (id: string) => ['--session', id], continueArgs: ['--continue'], history: true },
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    pickerLabel: 'Grok (xAI)',
    role: 'assistant',
    // xAI ships an API, not a CLI: nothing to probe on PATH and nothing to
    // launch a terminal session with, so this harness has no `terminal` spec
    // and is reached through the embedded chat provider instead.
    detection: { kind: 'api-key', env: ['XAI_API_KEY'], missingMessage: 'xAI API key is not configured (set XAI_API_KEY).' },
    context: { kind: 'native-agents-md' },
    skills: [PORTABLE_SKILLS],
    mcp: [ROOT_MCP],
    chatProviderIds: ['grok-native'],
  },
} as const satisfies Record<string, HarnessManifest>;

export type HarnessId = keyof typeof HARNESSES;

export type HarnessOfRole<R extends HarnessRole> = {
  [K in HarnessId]: (typeof HARNESSES)[K]['role'] extends R ? K : never;
}[HarnessId];

/** All harnesses, in the order they are offered to users. */
export const HARNESS_LIST: readonly HarnessManifest[] = Object.values(HARNESSES);

/** Ids whose `role` matches, in declaration order.
 *
 * The narrowing cast is contained here on purpose: it is the one place the
 * compile-time role-to-id mapping meets runtime filtering.
 */
function idsWithRole<R extends HarnessRole>(role: R): HarnessOfRole<R>[] {
  return (Object.keys(HARNESSES) as HarnessId[]).filter(
    (id) => (HARNESSES[id] as HarnessManifest).role === role,
  ) as HarnessOfRole<R>[];
}

/** Harnesses that generate workspace resources when selected. */
export const ASSISTANT_HARNESSES: readonly HarnessOfRole<'assistant'>[] = idsWithRole('assistant');

/**
 * Ids that declare a terminal spec, narrowed at the type level.
 *
 * Typed as the precise union rather than `HarnessId` on purpose: `CLI_HARNESSES`
 * and `SessionSource` are built from this list, so a widened type would claim a
 * credential-only harness is launchable and require a session reader for it.
 */
type LaunchableId = {
  [K in HarnessId]: (typeof HARNESSES)[K] extends { terminal: TerminalSpec } ? K : never;
}[HarnessId];

/** Harnesses with a local binary, and so a terminal target and saved sessions. */
export const LAUNCHABLE_HARNESSES: readonly LaunchableId[] = (Object.keys(HARNESSES) as HarnessId[])
  .filter((id) => (HARNESSES[id] as HarnessManifest).terminal !== undefined) as LaunchableId[];

/** The binary that hosts a terminal session, or undefined for a credential-only harness. */
export function launchCommandFor(harness: HarnessManifest): string | undefined {
  return harness.detection.kind === 'binary' ? harness.detection.launchCommand ?? harness.detection.probe : undefined;
}

/** Whether the harness is configured on this machine, per its detection kind. */
export function isHarnessConfigured(harness: HarnessManifest, hasBinary: (command: string) => boolean | undefined): boolean {
  if (harness.detection.kind === 'api-key') return harness.detection.env.some((name) => Boolean(process.env[name]));
  return hasBinary(harness.detection.probe) === true;
}

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && Object.hasOwn(HARNESSES, value);
}

export function isAssistantHarnessId(value: unknown): value is HarnessOfRole<'assistant'> {
  return isHarnessId(value) && HARNESSES[value].role === 'assistant';
}

export function getHarness(id: string): HarnessManifest | undefined {
  return isHarnessId(id) ? HARNESSES[id] : undefined;
}
export interface HarnessDescription {
  id: HarnessId;
  /** Name for terminal launch, the session list and logs. */
  label: string;
  /** Name for the workspace-creation picker, when it differs from `label`. */
  pickerLabel: string;
  role: HarnessRole;
  /** Selectable as a workspace assistant. */
  isAssistant: boolean;
  /** A local binary exists, so there is a terminal target. */
  isLaunchable: boolean;
  /** Saved sessions are discoverable. */
  hasHistory: boolean;
  /** Binary that hosts a terminal session; absent for a credential-only harness. */
  launchCommand?: string;
  /**
   * How the harness is detected on this machine. Binary harnesses are probed on
   * PATH; credential-only ones are configured by an environment variable.
   */
  detection: { kind: 'binary'; probe: string } | { kind: 'api-key'; env: string[]; missingMessage: string };
  /**
   * Args that resume a session, with {@link SESSION_ID_TOKEN} where the id goes.
   * Empty for a harness with no saved sessions.
   *
   * Shipped because the GUI used to rebuild this string itself with a ternary
   * that sent every harness except claude and codex to `agy --conversation`.
   */
  resumeArgs: string[];
  /** Workspace context file this harness reads, when it owns one. */
  contextPath?: string;
  /** Skill directories it discovers, relative to the workspace root. */
  skillRoots: string[];
  /** MCP configs it reads, relative to the workspace root. */
  mcpConfigPaths: string[];
  /** Agent definition directory, when the harness supports agent files. */
  agentsDir?: string;
}

/** Placeholder marking where a session id belongs in {@link HarnessDescription.resumeArgs}. */
export const SESSION_ID_TOKEN = '{sessionId}';

export function describeHarnesses(): HarnessDescription[] {
  return HARNESS_LIST.map((harness) => ({
    id: harness.id as HarnessId,
    label: harness.label,
    pickerLabel: harness.pickerLabel ?? harness.label,
    role: harness.role,
    isAssistant: harness.role === 'assistant',
    isLaunchable: launchCommandFor(harness) !== undefined,
    hasHistory: harness.terminal?.history ?? false,
    ...(launchCommandFor(harness) ? { launchCommand: launchCommandFor(harness) } : {}),
    detection:
      harness.detection.kind === 'binary'
        ? { kind: 'binary' as const, probe: harness.detection.probe }
        : { kind: 'api-key' as const, env: [...harness.detection.env], missingMessage: harness.detection.missingMessage },
    resumeArgs: harness.terminal ? harness.terminal.resumeArgs(SESSION_ID_TOKEN).map((arg) => `${arg}`) : [],
    ...(harness.context.kind === 'native-agents-md' ? {} : { contextPath: harness.context.path }),
    skillRoots: harness.skills.map((root) => root.root),
    mcpConfigPaths: (harness.mcp ?? []).map((target) => target.path),
    ...(harness.agents ? { agentsDir: harness.agents.dir } : {}),
  }));
}

/** The declared skill roots for a selection, portable roots deduplicated. */
export function skillRootsFor(assistants: readonly string[]): SkillRootSpec[] {
  const selected = assistants.map(getHarness).filter((h): h is HarnessManifest => Boolean(h));
  const roots = new Map<string, SkillRootSpec>();
  // Portable roots are materialized once when any selected harness declares one.
  for (const root of selected.flatMap((harness) => harness.skills)) {
    if (!roots.has(root.root)) roots.set(root.root, root);
  }
  return [...roots.values()];
}

/** Every MCP config the selection needs, deduplicated by path. */
export function mcpTargetsFor(assistants: readonly string[]): McpTargetSpec[] {
  const targets = new Map<string, McpTargetSpec>();
  for (const harness of assistants.map(getHarness)) {
    for (const target of harness?.mcp ?? []) {
      if (!targets.has(target.path)) targets.set(target.path, target);
    }
  }
  return [...targets.values()];
}
