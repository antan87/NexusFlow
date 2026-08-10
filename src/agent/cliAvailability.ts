/**
 * @module agent/cliAvailability
 * Whether a local CLI agent can actually be driven headlessly.
 *
 * The CLI providers previously reported `isConfigured: () => true` with the note
 * "assume the CLI is installed". That advertises a working provider in the UI even
 * when it cannot run, so a chat opens, the first turn fails, and the message the
 * user sees is whatever the CLI happened to print.
 *
 * The case worth naming: the Claude Code desktop app keeps OAuth tokens in memory
 * and injects them into the sessions it spawns itself, so `~/.claude/.credentials.json`
 * can exist with scopes but **empty tokens**. An interactive `claude` under the
 * desktop app then works while an independently spawned `claude -p` cannot
 * authenticate at all — the tokens simply are not on disk for it to find.
 *
 * Checks are synchronous because `ProviderAdapter.isConfigured()` is, and they are
 * deliberately conservative: a provider is only reported unusable when there is
 * positive evidence it cannot work, never merely because something is unfamiliar.
 */

import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface CliStatus {
  /** Whether a turn stands a chance of succeeding. */
  usable: boolean;
  /** User-facing explanation. Present whenever `usable` is false. */
  message?: string;
}

export interface DetectOptions {
  /** Overrides for tests. */
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Skips the PATH scan when availability is already known. */
  hasBinary?: boolean;
}

export interface CodexDetectOptions extends DetectOptions {
  /** Injected command outcome for deterministic tests. */
  loginStatus?: { exitCode: number | null; error?: string };
}

export interface CopilotDetectOptions extends DetectOptions {
  /** Injected command outcome for deterministic tests. */
  helpStatus?: { exitCode: number | null; output?: string; error?: string };
}

/**
 * Resolves an executable on PATH the way a shell would, honouring PATHEXT on
 * Windows so `claude.cmd` and `claude.exe` both count.
 */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = env.PATH ?? env.Path ?? '';
  if (!pathValue) return null;

  const separator = process.platform === 'win32' ? ';' : ':';
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  for (const dir of pathValue.split(separator).filter(Boolean)) {
    const base = path.join(dir.replace(/^"|"$/g, ''), name);
    const candidates = [base, ...extensions.map((extension) => base + extension.toLowerCase())];
    for (const candidate of candidates) {
      try {
        if (fsSync.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }

  return null;
}

interface StoredOauth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | string;
}

/** Reads the on-disk Claude credential store. Null when absent or unreadable. */
function readStoredOauth(homeDir: string): StoredOauth | null {
  const file = path.join(homeDir, '.claude', '.credentials.json');
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf-8')) as { claudeAiOauth?: StoredOauth };
    return parsed.claudeAiOauth ?? null;
  } catch {
    // Missing, malformed, or stored somewhere else entirely — all "unknown".
    return null;
  }
}

/**
 * Whether `claude` can be driven in print mode.
 *
 * Order matters: an API key makes the credential store irrelevant, and an absent
 * store is treated as unknown rather than broken so an installation that keeps
 * tokens elsewhere is never wrongly disabled.
 */
export function detectClaudeCliStatus(options: DetectOptions = {}): CliStatus {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  const hasBinary = options.hasBinary ?? findExecutable('claude', env) !== null;
  if (!hasBinary) {
    return {
      usable: false,
      message: 'The claude CLI was not found on PATH. Install Claude Code, or pick a provider that uses an API key.',
    };
  }

  if (env.ANTHROPIC_API_KEY) return { usable: true };

  const oauth = readStoredOauth(homeDir);
  if (!oauth) return { usable: true };

  const hasToken = Boolean(oauth.accessToken) || Boolean(oauth.refreshToken);
  if (hasToken) return { usable: true };

  // Tokens are absent, so nothing spawned from here can authenticate or renew.
  const hostManaged = Boolean(env.CLAUDE_CODE_ENTRYPOINT)
    || env.CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH === '1'
    || env.CLAUDECODE === '1';

  return {
    usable: false,
    message: hostManaged
      ? 'The claude CLI is installed but its stored credentials are empty, so a headless turn cannot authenticate. '
        + 'This happens when the Claude Code app holds your tokens in memory for its own sessions instead of writing them to disk. '
        + 'Run `claude` in a normal terminal and sign in, or set ANTHROPIC_API_KEY and use the Claude (API) provider.'
      : 'The claude CLI is installed but not signed in — its stored credentials are empty. '
        + 'Run `claude` in a terminal and sign in, or set ANTHROPIC_API_KEY and use the Claude (API) provider.',
  };
}

/** Whether the Antigravity CLI is present. It manages its own auth. */
export function detectAntigravityCliStatus(options: DetectOptions = {}): CliStatus {
  const env = options.env ?? process.env;
  const hasBinary = options.hasBinary ?? findExecutable('agy', env) !== null;

  return hasBinary
    ? { usable: true }
    : {
      usable: false,
      message: 'The Antigravity CLI (`agy`) was not found on PATH.',
    };
}

/**
 * Whether Codex can run non-interactively with the user's existing CLI login.
 * `codex login status` is the supported auth probe and does not expose or copy
 * the credential store. A ChatGPT subscription login is sufficient; no API key
 * is required.
 */
export function detectCodexCliStatus(options: CodexDetectOptions = {}): CliStatus {
  const env = options.env ?? process.env;
  const executable = options.hasBinary === false ? null : findExecutable('codex', env);
  const hasBinary = options.hasBinary ?? executable !== null;

  if (!hasBinary) {
    return {
      usable: false,
      message: 'The Codex CLI was not found on PATH. Install Codex, then run `codex login`.',
    };
  }

  let loginStatus = options.loginStatus;
  if (!loginStatus) {
    const result = spawnSync(executable ?? 'codex', ['login', 'status'], {
      env,
      encoding: 'utf-8',
      timeout: 5_000,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable ?? ''),
    });
    loginStatus = {
      exitCode: result.status,
      error: result.error?.message,
    };
  }

  if (loginStatus.exitCode === 0) return { usable: true };

  return {
    usable: false,
    message: loginStatus.error
      ? `The Codex CLI is installed, but NexusFlow could not verify its login (${loginStatus.error}). Run \`codex login\` and try again.`
      : 'The Codex CLI is installed but not signed in. Run `codex login` to use your ChatGPT account; no API key is required.',
  };
}

/**
 * Whether the installed Copilot CLI exposes its supported ACP server.
 *
 * Copilot has no documented non-interactive login-status command. Session
 * creation is therefore the authentication authority; this probe only avoids
 * advertising older installations that cannot speak ACP at all.
 */
export function detectCopilotCliStatus(options: CopilotDetectOptions = {}): CliStatus {
  const env = options.env ?? process.env;
  const executable = options.hasBinary === false ? null : findExecutable('copilot', env);
  const hasBinary = options.hasBinary ?? executable !== null;

  if (!hasBinary) {
    return {
      usable: false,
      message: 'The GitHub Copilot CLI was not found on PATH. Install it, then run `copilot login`.',
    };
  }

  // A classic PAT takes precedence over saved OAuth but is unsupported by the
  // Copilot CLI, so this is one credential failure we can identify safely.
  const token = env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (token?.startsWith('ghp_')) {
    return {
      usable: false,
      message: 'GitHub Copilot CLI does not support classic `ghp_` tokens. Remove the overriding token and run `copilot login`.',
    };
  }

  let helpStatus = options.helpStatus;
  if (!helpStatus) {
    const result = spawnSync(executable ?? 'copilot', ['help'], {
      env,
      encoding: 'utf-8',
      timeout: 5_000,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable ?? ''),
    });
    helpStatus = {
      exitCode: result.status,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      error: result.error?.message,
    };
  }

  if (helpStatus.exitCode === 0 && /--acp\b/.test(helpStatus.output ?? '')) {
    return { usable: true };
  }

  return {
    usable: false,
    message: helpStatus.error
      ? `NexusFlow could not inspect GitHub Copilot CLI ACP support (${helpStatus.error}). Update Copilot CLI and try again.`
      : 'The installed GitHub Copilot CLI does not expose ACP. Update it, then run `copilot login`.',
  };
}
