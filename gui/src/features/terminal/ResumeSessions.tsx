import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, RefreshCw, ArrowRight } from 'lucide-react';
import { apiFetch } from '../../lib/api/client.js';
import { Button } from '../../components/ui/button.js';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { SessionActivity } from '../sessions/SessionActivity.js';
import { SessionKind, mainSessionFor } from '../sessions/SessionKind.js';
import type { AISession } from '../../types.js';
import type { TerminalStatus } from './client.js';

export function ResumeSessions({ workspace, active, busy, status, fill, onStartNew, onResume }: { workspace: string; active: boolean; busy: boolean; status: TerminalStatus | null; fill: boolean; onStartNew: () => void; onResume: (session: AISession) => void }) {
  const [search, setSearch] = useState('');
  const [includeChildren, setIncludeChildren] = useState(false);
  // The same endpoint and records used by the workspace Sessions tab.
  const history = useQuery({ queryKey: ['terminal-resume-sessions', workspace], queryFn: () => apiFetch<{ sessions: AISession[] }>(`/api/workspace/${encodeURIComponent(workspace)}/sessions`), enabled: active, staleTime: 15_000 });
  const sessions = history.data?.sessions ?? [];
  const children = sessions.filter(s => s.threadKind === 'subagent').length;
  const visible = sessions.filter(s => (includeChildren || s.threadKind !== 'subagent') && `${s.title} ${harnessName(s.assistant)} ${s.id}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return <section aria-label="Continue a conversation" className={`min-h-0 overflow-auto border-b border-border bg-card p-3 ${fill ? 'flex-1' : 'max-h-[45%]'}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" />Continue a conversation</h3><Button size="xs" variant="ghost" aria-label="Refresh saved sessions" onClick={() => void history.refetch()}><RefreshCw className="size-3" /></Button></div>
    <p className="mt-1 text-xs text-muted-foreground">Choose a saved conversation. It opens in the CLI tool that created it.</p>
    {includeChildren && <p className="mt-1 text-[11px] text-muted-foreground">Subagents are delegated tasks. Continue their main conversation to pick up your work.</p>}
    <div className="my-2 flex flex-wrap items-center gap-2"><input aria-label="Search saved sessions" placeholder="Search conversations or harnesses" className="min-w-40 flex-1 rounded border border-border bg-background px-2 py-1 text-xs" value={search} onChange={e => setSearch(e.target.value)} /><label className="flex items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" checked={includeChildren} onChange={e => setIncludeChildren(e.target.checked)} />Include subagent sessions{children > 0 ? ` (${children})` : ''}</label></div>
    {history.isLoading && <p className="py-3 text-xs text-muted-foreground">Loading saved conversations…</p>}
    {history.error && <p role="alert" className="py-3 text-xs text-destructive">Could not load sessions. Use Refresh to try again.</p>}
    {!history.isLoading && !history.error && visible.length === 0 && <div className="space-y-2 py-3"><p className="text-xs text-muted-foreground">{search ? 'No matching conversations.' : children && !includeChildren ? 'Only subagent sessions were found. Include them to inspect their parent links.' : 'No saved conversations found for this workspace.'}</p>{!search && <Button size="xs" variant="outline" onClick={onStartNew}>Start a new session</Button>}</div>}
    <div className="max-h-72 divide-y divide-border">
      {visible.map(session => {
        const main = mainSessionFor(session, sessions);
        const tool = status?.targets.find(t => t.id === session.assistant);
        const available = !!status?.available && !!tool?.available;
        return <div key={`${session.assistant}:${session.id}`} className="flex items-center gap-2 py-2" data-testid="resume-session-row">
          <HarnessIcon harness={session.assistant} className="size-5 shrink-0" />
          <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium" title={session.title}>{session.title}</div><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground"><span>{harnessName(session.assistant)}</span><SessionKind session={session} /><SessionActivity session={session} /><span>{session.messageCount} messages</span><span className="font-mono">{session.id.slice(0, 8)}</span></div>{status && !available && <p className="text-[10px] text-amber-600">{tool?.reason || status.reason || `${harnessName(session.assistant)} is unavailable on this device.`}</p>}{!main && <p className="text-[10px] text-amber-600">Main conversation unavailable in saved history.</p>}</div>
          <Button size="xs" variant="outline" disabled={busy || !available || !main} title={!main ? 'Continue the main conversation from the harness' : !available ? 'Install this harness, then refresh the harness list' : `Continue ${main.title} in ${harnessName(main.assistant)}`} onClick={() => main && onResume(main)}><ArrowRight className="size-3" />{session.threadKind === 'subagent' ? 'Main thread' : 'Continue'}</Button>
        </div>;
      })}
    </div>
  </section>;
}
