/**
 * @module agent/cliAvailability
 * Whether a local CLI agent can actually be driven headlessly.
 *
 * The CLI providers previously reported `isConfigured: () => true` with the note
 * "assume the CLI is installed". That advertises a working provider in the UI even
 * when it cannot run, so a chat opens, the first turn fails, and the message the
 * user sees is whatever the CLI happened to print.
 *
 * Provider-owned status commands are the source of truth. In particular,
 * NexusFlow must not infer Claude login from private credential-file shapes:
 * newer installations may use a keychain or host-managed subscription login.
 *
 * Checks are synchronous because `ProviderAdapter.isConfigured()` is. Probe output
 * is reduced to a closed setup state so account and credential details never cross
 * the server boundary.
 */

import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface CliStatus {
  /** Whether a turn stands a chance of succeeding. */
  usable: boolean;
  /** User-facing explanation. Present whenever `usable` is false. */
  message?: string;
  setupIssue?: 'missing-cli' | 'signed-out' | 'probe-failed';
  recoveryCommand?: string;
  recoveryLabel?: string;
}

export interface DetectOptions {
  /** Overrides for tests. */
  env?: NodeJS.ProcessEnv;
  /** Skips the PATH scan when availability is already known. */
  hasBinary?: boolean;
}

export interface CodexDetectOptions extends DetectOptions {
  /** Injected command outcome for deterministic tests. */
  loginStatus?: { exitCode: number | null; error?: string };
}

export interface ClaudeDetectOptions extends DetectOptions {
  /** Injected command outcome for deterministic tests. */
  authStatus?: { exitCode: number | null; stdout?: string; error?: string };
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

  const separator = path.delimiter;
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  for (const dir of pathValue.split(separator).filter(Boolean)) {
    const base = path.join(dir.replace(/^"|"$/g, ''), name);
    const candidates = [
      base,
      ...extensions.map((extension) => base + (extension.startsWith('.') ? extension : `.${extension}`).toLowerCase()),
      ...extensions.map((extension) => base + (extension.startsWith('.') ? extension : `.${extension}`).toUpperCase()),
    ];
    const uniqueCandidates = Array.from(new Set(candidates));
    for (const candidate of uniqueCandidates) {
      try {
        if (fsSync.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }

  return null;
}

/**
 * Whether `claude` can be driven in print mode.
 *
 * `claude auth status --json` is the provider-owned authority. NexusFlow only
 * inspects the boolean `loggedIn` field and never reads or returns credential,
 * account, auth-method, or provider values.
 */
export function detectClaudeCliStatus(options: ClaudeDetectOptions = {}): CliStatus {
  const env = options.env ?? process.env;
  const executable = options.hasBinary === false ? null : findExecutable('claude', env);
  const hasBinary = options.hasBinary ?? executable !== null;
  if (!hasBinary) {
    return {
      usable: false,
      message: 'The Claude Code CLI was not found on PATH.',
      setupIssue: 'missing-cli',
      recoveryCommand: 'npm install -g @anthropic-ai/claude-code',
      recoveryLabel: 'Copy install command',
    };
  }

  if (
    env.ANTHROPIC_API_KEY
    || env.ANTHROPIC_AUTH_TOKEN
    || env.CLAUDE_CODE_USE_BEDROCK === '1'
    || env.CLAUDE_CODE_USE_VERTEX === '1'
    || env.CLAUDE_CODE_USE_FOUNDRY === '1'
  ) return { usable: true };

  let authStatus = options.authStatus;
  if (!authStatus) {
    const result = spawnSync(executable ?? 'claude', ['auth', 'status', '--json'], {
      env,
      encoding: 'utf-8',
      timeout: 5_000,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable ?? ''),
    });
    authStatus = {
      exitCode: result.status,
      stdout: result.stdout ?? '',
      error: result.error?.message,
    };
  }

  if (!authStatus.error && typeof authStatus.stdout === 'string') {
    try {
      const parsed = JSON.parse(authStatus.stdout) as { loggedIn?: unknown };
      if (parsed.loggedIn === true) return { usable: true };
      if (parsed.loggedIn === false) {
        return {
          usable: false,
          message: 'Claude Code is installed but not signed in. Use your Claude subscription; no API key is required.',
          setupIssue: 'signed-out',
          recoveryCommand: 'claude auth login',
          recoveryLabel: 'Copy sign-in command',
        };
      }
    } catch {
      // A changed or malformed provider response is a compatibility failure,
      // not evidence that the user is signed out.
    }
  }

  return {
    usable: false,
    message: 'NexusFlow could not verify Claude Code login. Check it in a terminal, then recheck.',
    setupIssue: 'probe-failed',
    recoveryCommand: 'claude auth status --json',
    recoveryLabel: 'Copy status command',
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
      message: 'The Codex CLI was not found on PATH.',
      setupIssue: 'missing-cli',
      recoveryCommand: 'npm install -g @openai/codex',
      recoveryLabel: 'Copy install command',
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

  if (!loginStatus.error && loginStatus.exitCode === 0) return { usable: true };

  if (!loginStatus.error && loginStatus.exitCode === 1) {
    return {
      usable: false,
      message: 'Codex is installed but not signed in. Use your ChatGPT account; no API key is required.',
      setupIssue: 'signed-out',
      recoveryCommand: 'codex login',
      recoveryLabel: 'Copy sign-in command',
    };
  }

  return {
    usable: false,
    message: 'NexusFlow could not verify Codex login. Check it in a terminal, then recheck.',
    setupIssue: 'probe-failed',
    recoveryCommand: 'codex login status',
    recoveryLabel: 'Copy status command',
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
