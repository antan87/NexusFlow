import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiCursor, SiGithubcopilot } from 'react-icons/si';
import { Pi, TerminalSquare } from 'lucide-react';
import { AntigravityIcon } from './AntigravityIcon.js';
import { useHarnesses } from '../../lib/api/queries.js';

/**
 * Display name for a harness, from the server's manifest.
 *
 * The id-to-name map that used to live here was a hand-copy of the backend's,
 * and `shell` was mixed into it even though it is not a harness. A harness the
 * server knew and this component did not rendered as its raw id.
 *
 * This is a hook returning a lookup, not a component: callers use the name
 * inside string templates, `title` attributes and search filters, where JSX
 * would not fit. `shell` stays a local name because it is a terminal, not a
 * harness, so the manifest has no entry for it.
 */
const LOCAL_NAMES: Record<string, string> = { shell: 'Shell' };

export function useHarnessName(): (id: string) => string {
  const harnesses = useHarnesses();
  const labels = new Map((harnesses.data ?? []).map((harness) => [harness.id, harness.label]));
  return (id: string) => labels.get(id) ?? LOCAL_NAMES[id] ?? id;
}

/**
 * Icons are presentation, so this registry cannot come from the manifest: a
 * component and a class name are not data. It is keyed by the manifest's `id`
 * and falls back to a neutral terminal glyph, so a harness the server adds and
 * this file has not heard of still renders correctly.
 */
export function HarnessIcon({ harness, className = 'size-4' }: { harness: string; className?: string }) {
  if (harness === 'antigravity') return <AntigravityIcon className={className} alt="" aria-hidden="true" />;
  const icons: Record<string, typeof BsOpenai> = { codex: BsOpenai, claude: SiClaude, copilot: SiGithubcopilot, cursor: SiCursor, pi: Pi };
  const Icon = icons[harness] ?? TerminalSquare;
  return <Icon className={className} aria-hidden="true" />;
}
