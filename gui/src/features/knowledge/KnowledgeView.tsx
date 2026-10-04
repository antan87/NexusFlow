import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Input } from '../../components/ui/input.js';
import { cn } from '../../lib/utils.js';
import { matchesKnowledge, parseKnowledge, readableTitle, type KnowledgeKind } from './knowledgeEntries.js';

const KIND_LABEL: Record<KnowledgeKind, string> = { decision: 'Decision', gotcha: 'Gotcha', assumption: 'Assumption', question: 'Question', note: 'Note' };
const KIND_TONE: Record<KnowledgeKind, string> = { decision: 'ai', gotcha: 'needs', assumption: 'idle', question: 'reopened', note: 'idle' };
type Filter = 'all' | 'decision' | 'gotcha';

/**
 * What the assistants learned in this workspace, as entries: decisions with their reasons, and the gotchas that cost
 * time. Newest first, searchable, and filtered by kind. A file that does not use the entry format is shown as written.
 */
export function KnowledgeView({ markdown }: { markdown: string }) {
  const knowledge = useMemo(() => parseKnowledge(markdown), [markdown]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  if (!knowledge.entries.length) return <ChatMarkdown content={markdown} />;

  const counts = { decision: knowledge.entries.filter((entry) => entry.kind === 'decision').length, gotcha: knowledge.entries.filter((entry) => entry.kind === 'gotcha').length };
  const shown = knowledge.entries.filter((entry) => (filter === 'all' || entry.kind === filter) && matchesKnowledge(entry, query));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search the knowledge" placeholder="Search the knowledge…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" />
        </div>
        <div role="group" aria-label="Show" className="inline-flex rounded-md border border-border p-0.5">
          {([['all', `All ${knowledge.entries.length}`], ['decision', `Decisions ${counts.decision}`], ['gotcha', `Gotchas ${counts.gotcha}`]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={cn('h-7 rounded px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring', filter === value ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <p role="status" className="py-4 text-sm text-muted-foreground">Nothing matches.</p> : (
        <ol aria-label="Knowledge entries" className="space-y-2">
          {shown.map((entry) => (
            <li key={entry.id}>
              <article className="rounded-lg border border-border bg-card px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="state-chip" data-tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</span>
                  {entry.date && <time dateTime={entry.date} className="text-[11px] text-muted-foreground">{entry.date}</time>}
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-foreground">{readableTitle(entry.title)}</h3>
                {entry.text && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{entry.text}</p>}
                {(entry.scope || entry.evidence) && (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {entry.scope && <span className="min-w-0 break-all">Applies to <code className="font-mono">{entry.scope}</code></span>}
                    {entry.evidence && <span>{entry.evidence}</span>}
                  </p>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
