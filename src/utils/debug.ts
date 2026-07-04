/**
 * @module utils/debug
 * Opt-in debug logging. Enabled via `NEXUSFLOW_DEBUG=1` (or the global
 * `--debug` flag, which sets it). All output goes to **stderr** — the MCP
 * server's stdout must stay a clean JSON-RPC stream.
 */

import chalk from 'chalk';

/** Whether debug logging is enabled. */
export function isDebug(): boolean {
  return process.env.NEXUSFLOW_DEBUG === '1' || process.env.NEXUSFLOW_DEBUG === 'true';
}

/**
 * Logs a debug message to stderr when debug mode is on. No-op otherwise.
 *
 * @param scope   - Short subsystem tag, e.g. 'storage' or 'plugins'.
 * @param message - What happened.
 * @param error   - Optional error to append.
 */
export function debugLog(scope: string, message: string, error?: unknown): void {
  if (!isDebug()) return;
  const suffix = error ? ` — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}` : '';
  console.error(chalk.dim(`[nexusflow:${scope}] ${message}${suffix}`));
}
