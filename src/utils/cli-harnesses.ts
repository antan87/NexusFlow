/** CLI capabilities shared by terminal launch and saved-session discovery.
 * A new history-capable harness must register a complete reader in session-readers.
 * The GUI receives history sources from the API, so it needs no source list.
 *
 * This table is derived from the harness manifest rather than maintained beside
 * it: two lists of the same binaries and resume flags is exactly how pi ended up
 * launchable but absent from every assistant-driven surface.
 *
 * Harnesses with no local binary are absent by construction. A credential-only
 * harness such as Grok has nothing to launch, so offering it as a terminal
 * target would produce an entry that can never work.
 */
import { HARNESSES, LAUNCHABLE_HARNESSES, getHarness, launchCommandFor, type HarnessManifest } from '../harness/manifest.js';

/** The manifest's terminal spec, or `never` for a harness that has none. */
type TerminalOf<T> = T extends { terminal?: infer U } ? NonNullable<U> : never;

/**
 * Kept generic over the terminal spec rather than the manifest so the literal
 * `history` flags survive. `SessionSource` below is computed by testing
 * `history extends true`, so widening to `boolean` would collapse the union to
 * `'workspace'` and break every caller that switches on a harness id.
 */
type CliHarnessEntry<T extends TerminalOf<HarnessManifest> = TerminalOf<HarnessManifest>> = {
  name: string;
  binary: string;
  terminalBinaries?: string[];
  resumeArgs: T['resumeArgs'];
  continueArgs: T['continueArgs'];
  history: T['history'];
};

export const CLI_HARNESSES = Object.fromEntries(
  LAUNCHABLE_HARNESSES.map((id) => {
    const harness = getHarness(id)!;
    const terminal = harness.terminal!;
    return [
      id,
      {
        name: harness.label,
        binary: launchCommandFor(harness) ?? harness.id,
        ...(terminal.terminalBinaries ? { terminalBinaries: terminal.terminalBinaries } : {}),
        resumeArgs: terminal.resumeArgs,
        continueArgs: terminal.continueArgs,
        history: terminal.history,
      },
    ];
  }),
) as { [K in (typeof LAUNCHABLE_HARNESSES)[number]]: CliHarnessEntry<TerminalOf<(typeof HARNESSES)[K]>> };

export type CliHarnessId = keyof typeof CLI_HARNESSES;
export type SessionSource = { [K in CliHarnessId]: typeof CLI_HARNESSES[K]['history'] extends true ? K : never }[CliHarnessId] | 'workspace';
export const SESSION_SOURCES: SessionSource[] = [
  ...(Object.keys(CLI_HARNESSES) as CliHarnessId[]).filter((id): id is Exclude<SessionSource, 'workspace'> => CLI_HARNESSES[id].history),
  'workspace',
];

export function isCliHarnessId(id: string): id is CliHarnessId {
  return Object.hasOwn(CLI_HARNESSES, id);
}
