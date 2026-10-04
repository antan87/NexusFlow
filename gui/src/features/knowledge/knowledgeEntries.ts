/**
 * The knowledge file as entries a developer can read: what was decided or learned, when, where it applies, and the
 * evidence. The file stays the source (assistants append to it with `ctxspace knowledge add`); this only reads it.
 */

export type KnowledgeKind = 'decision' | 'gotcha' | 'assumption' | 'question' | 'note';

export interface KnowledgeEntry {
  /** Unique within the file, for list keys. */
  id: string;
  date?: string;
  title: string;
  kind: KnowledgeKind;
  text: string;
  /** Where it applies, without the `path:` style prefix. */
  scope?: string;
  evidence?: string;
}

export interface KnowledgeDocument {
  /** The feature goal the file opens with, if it has one. */
  goal: string;
  /** Newest first. */
  entries: KnowledgeEntry[];
}

const HEADING = /^###\s+(?:(\d{4}-\d{2}-\d{2})\s+[—–-]\s+)?(.+?)\s*$/;
const FIELD = /^\*\*(Decision|Gotcha|Assumption|Question|Note|Scope|Evidence):\*\*\s*(.*)$/i;
const KINDS: Record<string, KnowledgeKind> = { decision: 'decision', gotcha: 'gotcha', assumption: 'assumption', question: 'question', note: 'note' };

/** The kind a section implies, for an entry that does not say. */
const kindOfSection = (section: string): KnowledgeKind => (/gotcha/i.test(section) ? 'gotcha' : /question/i.test(section) ? 'question' : /assumption/i.test(section) ? 'assumption' : /decision/i.test(section) ? 'decision' : 'note');

const plainScope = (value: string) => value.replace(/`/g, '').replace(/^(path|repo|seam):\s*/i, '').trim();

export function parseKnowledge(markdown: string): KnowledgeDocument {
  const entries: KnowledgeEntry[] = [];
  const goal: string[] = [];
  let section = '';
  let current: KnowledgeEntry | null = null;
  const flush = () => {
    if (current) entries.push({ ...current, text: current.text.trim() });
    current = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^##\s/.test(line)) { flush(); section = line.replace(/^##\s+/, '').trim(); continue; }
    if (/^#\s/.test(line)) { flush(); continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      current = { id: `${entries.length}`, date: heading[1], title: heading[2]!.trim(), kind: kindOfSection(section), text: '' };
      continue;
    }
    if (current) {
      const field = FIELD.exec(line);
      if (field) {
        const name = field[1]!.toLowerCase();
        if (name === 'scope') current.scope = plainScope(field[2]!);
        else if (name === 'evidence') current.evidence = field[2]!.trim();
        else { current.kind = KINDS[name] ?? current.kind; current.text = `${current.text}\n${field[2]}`; }
      } else if (line.trim()) current.text = `${current.text}\n${line.trim()}`;
      continue;
    }
    if (/^feature goal$/i.test(section) && line.trim()) goal.push(line.trim());
  }
  flush();
  // Newest first; entries of the same day keep the order they were written in.
  const ordered = entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.date ?? '').localeCompare(a.entry.date ?? '') || b.index - a.index)
    .map(({ entry }) => entry);
  return { goal: goal.join('\n'), entries: ordered };
}

/** "chat-first-workspace-layout" reads as "Chat first workspace layout"; a title that is already words is kept. */
export function readableTitle(title: string): string {
  if (/\s/.test(title)) return title;
  const words = title.replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : title;
}

/** Whether an entry matches a search: its title, text, scope or evidence, ignoring case. */
export function matchesKnowledge(entry: KnowledgeEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [readableTitle(entry.title), entry.title, entry.text, entry.scope ?? '', entry.evidence ?? ''].some((part) => part.toLowerCase().includes(needle));
}
