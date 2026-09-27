/** CLI capabilities shared by terminal launch and saved-session discovery.
 * Add a history reader in session-finder before setting `history: true`.
 * The GUI receives history sources from the API, so it needs no source list.
 */
export const CLI_HARNESSES = {
  antigravity: { name: 'Antigravity (agy)', binary: 'agy', resumeArgs: (id: string) => ['--conversation', id], continueArgs: ['--continue'], history: true },
  claude: { name: 'Claude Code', binary: 'claude', resumeArgs: (id: string) => ['--resume', id], continueArgs: ['--resume'], history: true },
  codex: { name: 'Codex', binary: 'codex', resumeArgs: (id: string) => ['resume', id], continueArgs: ['resume'], history: true },
  copilot: { name: 'GitHub Copilot', binary: 'copilot', resumeArgs: (id: string) => ['--resume', id], continueArgs: ['--resume'], history: true },
  cursor: { name: 'Cursor Agent', binary: 'cursor-agent', resumeArgs: (id: string) => ['--resume', id], continueArgs: [], history: false },
  pi: { name: 'Pi', binary: 'pi', resumeArgs: (id: string) => ['--session', id], continueArgs: ['--continue'], history: true },
} as const;

export type CliHarnessId = keyof typeof CLI_HARNESSES;
export type SessionSource = { [K in CliHarnessId]: typeof CLI_HARNESSES[K]['history'] extends true ? K : never }[CliHarnessId] | 'workspace';
export const SESSION_SOURCES: SessionSource[] = [
  ...(Object.keys(CLI_HARNESSES) as CliHarnessId[]).filter((id): id is Exclude<SessionSource, 'workspace'> => CLI_HARNESSES[id].history),
  'workspace',
];

export function isCliHarnessId(id: string): id is CliHarnessId {
  return Object.hasOwn(CLI_HARNESSES, id);
}
