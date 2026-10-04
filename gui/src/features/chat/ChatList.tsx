import { useEffect, useRef, useState } from 'react';
import { CircleCheckBig, LayoutList, X } from 'lucide-react';

import { ContextRing } from '../../components/ui/context-ring.js';
import { IconButton } from '../../components/ui/icon-button.js';
import { Popover, PopoverPopup, PopoverTrigger } from '../../components/ui/popover.js';
import { cn } from '../../lib/utils.js';
import type { ProgressFacts } from '../../types.js';
import { currentMilestoneIndex, ringMilestones } from '../progress/progressView.js';
import { sortThreads, type ThreadSummary } from './chatThreads.js';
import { liveText, type LiveSessions } from './liveSessions.js';
import { LiveMarker } from './LiveMarker.js';

export interface ChatListRow {
  branch: string;
  name: string;
  summary: ThreadSummary;
  facts?: ProgressFacts;
  /** The CLI running in the chat, if one is. */
  live?: LiveSessions;
}

interface ChatListProps {
  rows: readonly ChatListRow[];
  /** When the running CLIs were read. */
  now: number;
  activeBranch: string | null;
  onOpen: (branch: string) => void;
  onFinish: (branch: string) => void;
  onClose: (branch: string) => void;
}

function Row({ row, active, now, onOpen, onFinish, onClose }: { row: ChatListRow; active: boolean } & Pick<ChatListProps, 'now' | 'onOpen' | 'onFinish' | 'onClose'>) {
  const { branch, name, summary, facts, live } = row;
  return (
    <li className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted/60 focus-within:bg-muted/60" data-branch={branch}>
      <button
        type="button" onClick={() => onOpen(branch)} aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md py-0.5 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ContextRing aria-hidden="true" size={22} milestones={ringMilestones(facts)} currentIndex={currentMilestoneIndex(facts)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-[13px] leading-tight text-foreground', active ? 'font-semibold' : 'font-medium')} title={`${name} (${branch})`}>{name}</span>
            {live && <LiveMarker live={live} now={now} />}
            {summary.label && <span className="state-chip shrink-0" data-tone={summary.tone}>{summary.label}</span>}
          </span>
          {/* While the AI waits, what it asked matters more than the goal. */}
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground" title={summary.question || summary.goal || undefined}>
            {summary.question || summary.goal || 'No goal set yet'}
          </span>
          {live && <span className="sr-only">{liveText(live, now)}</span>}
        </span>
      </button>
      {/* Quiet until the row is pointed at or focused, except on finished work, where it is the next step. */}
      <IconButton
        label={`Review and finish ${name}`} icon={<CircleCheckBig />} onClick={() => onFinish(branch)}
        className={cn(summary.finished ? 'text-[var(--state-done)]' : 'text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}
      />
      <IconButton
        label={`Close the chat of ${name}`} icon={<X />} onClick={() => onClose(branch)}
        className="text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
      />
    </li>
  );
}

/**
 * Every open chat in one list: what it is working on, how far it is and whether it needs you, with what needs you
 * first and finished work together at the end, where Review and finish is one click. The tabs keep the order the
 * chats were opened in, so they stay where the hand expects them; this list is ordered by attention instead.
 */
export function ChatList({ rows, now, activeBranch, onOpen, onFinish, onClose }: ChatListProps) {
  const [open, setOpen] = useState(false);
  const sorted = sortThreads(rows.map((row) => ({ ...row, tone: row.summary.tone })));
  const working = sorted.filter((row) => !row.summary.finished);
  const finished = sorted.filter((row) => row.summary.finished);
  const choose = (action: (branch: string) => void) => (branch: string) => { setOpen(false); action(branch); };

  // Closing a chat removes the row that has focus. The row that takes its place gets it, so the keyboard stays in the
  // list. Closing the chat on screen brings another to the front, whose terminal takes focus, so the list closes and
  // the developer is in that chat; closing the last one closes the list too.
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfterClose = useRef<string | null>(null);
  const closeRow = (branch: string) => {
    const order = [...working, ...finished].map((row) => row.branch);
    const rest = order.filter((other) => other !== branch);
    if (rest.length === 0 || branch === activeBranch) setOpen(false);
    else focusAfterClose.current = rest[Math.min(order.indexOf(branch), rest.length - 1)]!;
    onClose(branch);
  };
  useEffect(() => {
    const branch = focusAfterClose.current;
    if (!branch) return;
    focusAfterClose.current = null;
    listRef.current?.querySelector<HTMLElement>(`li[data-branch="${CSS.escape(branch)}"] button`)?.focus();
  }, [rows]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="All chats" title="All chats"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LayoutList aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-[min(26rem,calc(100vw-2rem))]" viewportClassName="p-1.5 [--viewport-inline-padding:--spacing(1.5)]">
        <div ref={listRef} className="w-full">
          {working.length > 0 && (
            <>
              <h2 className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open chats</h2>
              <ul aria-label="Open chats" className="flex max-h-[min(24rem,60vh)] flex-col gap-0.5 overflow-y-auto">
                {working.map((row) => <Row key={row.branch} row={row} active={row.branch === activeBranch} now={now} onOpen={choose(onOpen)} onFinish={choose(onFinish)} onClose={closeRow} />)}
              </ul>
            </>
          )}
          {finished.length > 0 && (
            <>
              <h2 className={cn('px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', working.length > 0 && 'mt-1.5 border-t border-border')}>Ready to finish</h2>
              <ul aria-label="Ready to finish" className="flex flex-col gap-0.5">
                {finished.map((row) => <Row key={row.branch} row={row} active={row.branch === activeBranch} now={now} onOpen={choose(onOpen)} onFinish={choose(onFinish)} onClose={closeRow} />)}
              </ul>
            </>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
