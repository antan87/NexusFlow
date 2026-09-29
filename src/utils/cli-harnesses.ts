/** CLI capabilities shared by terminal launch and saved-session discovery.
 * A new history-capable harness must register a complete reader in session-readers.
 * The GUI receives history sources from the API, so it needs no source list.
 *
 * This table is derived from the harness manifest rather than maintained beside
 * it: two lists of the same binaries and resume flags is exactly how pi ended up
 * launchable but absent from every assistant-driven surface.
 */
import { HARNESSES, type HarnessId, type HarnessManifest } from '../harness/manifest.js';

type CliHarnessEntry<T extends HarnessManifest> = {
  name: string;
  binary: string;
  terminalBinaries?: string[];
  resumeArgs: T['terminal']['resumeArgs'];
  continueArgs: T['terminal']['continueArgs'];
  /**
   * Kept as the manifest's literal `true`/`false` rather than widened to
   * `boolean`: `SessionSource` below is derived by testing `history extends
   * true`, so widening it here would collapse the union to `'workspace'` and
   * break every caller that switches on a harness id.
   */
  history: T['terminal']['history'];
};

function toCliHarness<T extends HarnessManifest>(harness: T): CliHarnessEntry<T> {
  return {
    name: harness.label,
    binary: harness.detection.launchCommand ?? harness.detection.probe,
    ...(harness.terminal.terminalBinaries ? { terminalBinaries: harness.terminal.terminalBinaries } : {}),
    resumeArgs: harness.terminal.resumeArgs,
    continueArgs: harness.terminal.continueArgs,
    history: harness.terminal.history,
  };
}

export const CLI_HARNESSES = Object.fromEntries(
  (Object.keys(HARNESSES) as HarnessId[]).map((id) => [id, toCliHarness(HARNESSES[id])]),
) as { [K in HarnessId]: CliHarnessEntry<(typeof HARNESSES)[K]> };

export type CliHarnessId = keyof typeof CLI_HARNESSES;
export type SessionSource = { [K in CliHarnessId]: typeof CLI_HARNESSES[K]['history'] extends true ? K : never }[CliHarnessId] | 'workspace';
export const SESSION_SOURCES: SessionSource[] = [
  ...(Object.keys(CLI_HARNESSES) as CliHarnessId[]).filter((id): id is Exclude<SessionSource, 'workspace'> => CLI_HARNESSES[id].history),
  'workspace',
];

export function isCliHarnessId(id: string): id is CliHarnessId {
  return Object.hasOwn(CLI_HARNESSES, id);
}
