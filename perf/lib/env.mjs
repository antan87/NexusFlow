/**
 * Process environment that confines ContextSpace to a perf fixture.
 *
 * The app finds its config, workspaces and assistant histories through the
 * home directory, so HOME is the isolation boundary. Variables that would
 * redirect a history source elsewhere are removed, so a developer's shell can
 * never leak real sessions into a measurement.
 */
import * as path from 'node:path';

const REDIRECTING_VARS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'ANTIGRAVITY_CLI_HOME',
  'ANTIGRAVITY_HOME',
  'GEMINI_CLI_HOME',
  'PI_CODING_AGENT_DIR',
  'COPILOT_HOME',
  'CONTEXTSPACE_HOME',
  'NEXUSFLOW_HOME',
  'CONTEXTSPACE_PORT',
  'NEXUSFLOW_PORT',
  'CS_PORT',
  'NF_PORT',
  'CONTEXTSPACE_DESKTOP_URI',
  'NEXUSFLOW_DESKTOP_URI',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
];

export function fixtureEnv(fixtureHome, extra = {}) {
  const env = { ...process.env };
  for (const name of REDIRECTING_VARS) delete env[name];
  const home = path.resolve(fixtureHome);
  return { ...env, HOME: home, USERPROFILE: home, ...extra };
}
