/**
 * @module core/brand-config
 * Centralized, strongly-typed Brand and Naming Configuration System.
 *
 * Governs all product identities, CLI binary names, aliases, manifest files,
 * lockfiles, markdown artifacts, environment variables, sentinels, and fallback
 * chains.
 *
 * Future rebrands or white-label naming changes only require updating this
 * configuration structure.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface FileNamingPair {
  /** The canonical, current filename. */
  readonly primary: string;
  /** Legacy fallback filename for backward compatibility. */
  readonly legacy: string;
}

export interface BrandConfigSchema {
  readonly identity: {
    readonly name: string;
    readonly shortName: string;
    readonly legacyName: string;
    readonly cliName: string;
    readonly cliAliases: readonly string[];
    readonly tagline: string;
  };
  readonly files: {
    readonly manifest: FileNamingPair;
    readonly lock: FileNamingPair;
    readonly knowledge: FileNamingPair;
    readonly plan: FileNamingPair;
    readonly overview: FileNamingPair;
    readonly handoff: FileNamingPair;
    readonly cursorRule: FileNamingPair;
    readonly configDir: FileNamingPair;
    readonly state: FileNamingPair;
    readonly runningState: FileNamingPair;
    readonly analysisCache: FileNamingPair;
    readonly logsDir: FileNamingPair;
    readonly mutationLock: FileNamingPair;
  };
  readonly env: {
    readonly home: readonly string[];
    readonly port: readonly string[];
    readonly packagedExe: readonly string[];
    readonly desktopLog: readonly string[];
  };
  readonly mcp: {
    readonly serverName: string;
    readonly legacyServerName: string;
    readonly packageName: string;
    readonly legacyPackageName: string;
  };
  readonly extension: {
    readonly id: string;
    readonly legacyId: string;
    readonly commandPrefix: string;
    readonly legacyCommandPrefix: string;
  };
  readonly desktop: {
    readonly appId: string;
    readonly productName: string;
    readonly legacyProductName: string;
    readonly installerName: string;
    readonly legacyInstallerName: string;
    readonly readyTokenPrefixes: readonly string[];
  };
  readonly sentinels: {
    readonly freshnessStart: readonly string[];
    readonly freshnessEnd: readonly string[];
  };
}

export const BRAND_CONFIG: BrandConfigSchema = {
  identity: {
    name: 'ContextSpace',
    shortName: 'CS',
    legacyName: 'NexusFlow',
    cliName: 'ctxspace',
    cliAliases: ['contextspace', 'cs', 'nexusflow'],
    tagline: 'Deterministic AI Context Engine & Multi-Repo Workspace Orchestrator',
  },
  files: {
    manifest: {
      primary: 'contextspace.json',
      legacy: 'nexusflow.json',
    },
    lock: {
      primary: 'contextspace.lock',
      legacy: 'nexusflow.lock',
    },
    knowledge: {
      primary: 'contextspace-knowledge.md',
      legacy: 'nexusflow-knowledge.md',
    },
    plan: {
      primary: 'contextspace-plan.md',
      legacy: 'nexusflow-plan.md',
    },
    overview: {
      primary: 'contextspace-overview.md',
      legacy: 'nexusflow-overview.md',
    },
    handoff: {
      primary: 'contextspace-handoff.md',
      legacy: 'nexusflow-handoff.md',
    },
    cursorRule: {
      primary: '.cursor/rules/contextspace.mdc',
      legacy: '.cursor/rules/nexusflow.mdc',
    },
    configDir: {
      primary: '.contextspace',
      legacy: '.nexusflow',
    },
    state: {
      primary: '.contextspace-state.json',
      legacy: '.nexusflow-state.json',
    },
    runningState: {
      primary: '.contextspace-running.json',
      legacy: '.nexusflow-running.json',
    },
    analysisCache: {
      primary: '.contextspace-analysis-cache.json',
      legacy: '.nexusflow-analysis-cache.json',
    },
    logsDir: {
      primary: '.contextspace-logs',
      legacy: '.nexusflow-logs',
    },
    mutationLock: {
      primary: '.contextspace-mutation.lock',
      legacy: '.nexusflow-mutation.lock',
    },
  },
  env: {
    home: ['CONTEXTSPACE_HOME', 'NEXUSFLOW_HOME'],
    port: ['CONTEXTSPACE_PORT', 'CS_PORT', 'NEXUSFLOW_PORT', 'NF_PORT'],
    packagedExe: ['CONTEXTSPACE_PACKAGED_EXE', 'NEXUSFLOW_PACKAGED_EXE'],
    desktopLog: ['CONTEXTSPACE_DESKTOP_LOG', 'NEXUSFLOW_DESKTOP_LOG'],
  },
  mcp: {
    serverName: 'contextspace-mcp',
    legacyServerName: 'nexusflow-mcp',
    packageName: '@mrpatronz/contextspace',
    legacyPackageName: '@mrpatronz/nexusflow',
  },
  extension: {
    id: 'contextspace.contextspace-vscode',
    legacyId: 'nexusflow.nexusflow-vscode',
    commandPrefix: 'contextspace',
    legacyCommandPrefix: 'nexusflow',
  },
  desktop: {
    appId: 'se.hogia.contextspace',
    productName: 'ContextSpace',
    legacyProductName: 'NexusFlow',
    installerName: 'ContextSpaceSetup.exe',
    legacyInstallerName: 'NexusFlowSetup.exe',
    readyTokenPrefixes: ['CONTEXTSPACE_READY_PORT', 'NEXUSFLOW_READY_PORT'],
  },
  sentinels: {
    freshnessStart: ['CONTEXTSPACE:FRESHNESS:START', 'NEXUSFLOW:FRESHNESS:START'],
    freshnessEnd: ['CONTEXTSPACE:FRESHNESS:END', 'NEXUSFLOW:FRESHNESS:END'],
  },
} as const;

export type FileKey = keyof typeof BRAND_CONFIG.files;

// ─── Typed Resolution Helpers ────────────────────────────────────────────────

/**
 * Returns the first non-empty value from a list of environment variable names.
 */
export function resolveFirstEnv(envKeys: readonly string[]): string | undefined {
  for (const key of envKeys) {
    const val = process.env[key];
    if (val && val !== 'undefined' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

/**
 * Resolves the ContextSpace global home directory.
 * Priority: CONTEXTSPACE_HOME -> NEXUSFLOW_HOME -> ~/.contextspace -> ~/.nexusflow -> ~/.contextspace
 */
export function resolveBrandHomeDir(): string {
  const envDir = resolveFirstEnv(BRAND_CONFIG.env.home);
  if (envDir) {
    return path.resolve(envDir);
  }
  const primary = path.join(os.homedir(), BRAND_CONFIG.files.configDir.primary);
  const legacy = path.join(os.homedir(), BRAND_CONFIG.files.configDir.legacy);
  if (existsSync(primary)) return primary;
  if (existsSync(legacy)) return legacy;
  return primary;
}

/**
 * Resolves the path of a file key within a workspace, checking primary then legacy.
 * If neither exists, returns the canonical primary path.
 */
export async function resolveWorkspaceFilePath(
  workspaceDir: string,
  key: FileKey,
): Promise<{ path: string; isLegacy: boolean; exists: boolean }> {
  const pair = BRAND_CONFIG.files[key];
  const primaryPath = path.join(workspaceDir, pair.primary);
  try {
    await fs.access(primaryPath);
    return { path: primaryPath, isLegacy: false, exists: true };
  } catch {
    const legacyPath = path.join(workspaceDir, pair.legacy);
    try {
      await fs.access(legacyPath);
      return { path: legacyPath, isLegacy: true, exists: true };
    } catch {
      return { path: primaryPath, isLegacy: false, exists: false };
    }
  }
}

/**
 * Synchronously resolves a workspace file path with fallback to legacy.
 */
export function resolveWorkspaceFilePathSync(
  workspaceDir: string,
  key: FileKey,
): { path: string; isLegacy: boolean; exists: boolean } {
  const pair = BRAND_CONFIG.files[key];
  const primaryPath = path.join(workspaceDir, pair.primary);
  if (existsSync(primaryPath)) {
    return { path: primaryPath, isLegacy: false, exists: true };
  }
  const legacyPath = path.join(workspaceDir, pair.legacy);
  if (existsSync(legacyPath)) {
    return { path: legacyPath, isLegacy: true, exists: true };
  }
  return { path: primaryPath, isLegacy: false, exists: false };
}

/**
 * Generates the PM2 prefix scoped to a workspace hash.
 */
export function getPm2ProcessPrefix(workspacePath: string): string {
  const base = path.basename(workspacePath).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24);
  const hash = createHash('sha256').update(path.resolve(workspacePath)).digest('hex').slice(0, 8);
  return `${BRAND_CONFIG.identity.cliName}-${base}-${hash}-`;
}

/**
 * Generates stdout tokens for the desktop readiness handshake.
 */
export function getDesktopReadyTokens(port: number): string[] {
  return BRAND_CONFIG.desktop.readyTokenPrefixes.map((prefix) => `${prefix}=${port}`);
}

/**
 * Returns a RegExp matching any supported desktop ready port token.
 */
export function getDesktopReadyPortRegex(): RegExp {
  const prefixes = BRAND_CONFIG.desktop.readyTokenPrefixes.join('|');
  return new RegExp(`(?:${prefixes})=(\\d+)`);
}

/**
 * Returns a RegExp matching any supported freshness comment sentinel block.
 */
export function getFreshnessSentinelRegex(): RegExp {
  const startTokens = BRAND_CONFIG.sentinels.freshnessStart.join('|');
  const endTokens = BRAND_CONFIG.sentinels.freshnessEnd.join('|');
  return new RegExp(`<!--\\s*(?:${startTokens})\\s*-->[\\s\\S]*?<!--\\s*(?:${endTokens})\\s*-->`);
}

/**
 * Formats a canonical freshness sentinel comment block.
 */
export function createFreshnessMarker(snapshotSha: string, command: string = `${BRAND_CONFIG.identity.cliName} refresh --check`): string {
  return `<!-- ${BRAND_CONFIG.sentinels.freshnessStart[0]} -->\n> **${BRAND_CONFIG.identity.name} snapshot:** ${BRAND_CONFIG.identity.name}@${snapshotSha}. Verify live state with \`${command}\`.\n<!-- ${BRAND_CONFIG.sentinels.freshnessEnd[0]} -->`;
}
