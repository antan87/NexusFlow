import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { ArrowRight, ChevronDown, RefreshCw } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { ContextRing } from '../../components/ui/context-ring.js';
import { ApiError } from '../../lib/api/client.js';
import { useAcknowledgeQuestions, useProgressFacts, useReopenMilestone, useWorkGuidance, useWorkspaceChanges } from '../../lib/api/queries.js';
import { cn } from '../../lib/utils.js';
import type { ProgressFacts, WorkGuidance } from '../../types.js';
import { ProgressPanel } from './ProgressPanel.js';
import { activeProposals, currentMilestoneIndex, factsLine, goalLine, latestNext, nextAction, ringMilestones, stripState, type NextAction } from './progressView.js';
import { useScreenFeed } from './useScreenFeed.js';

const NOTICE_MS = 6000;
const RING_SIZE = 30;

export interface WhereAreWeBarProps {
  facts: ProgressFacts;
  guidance?: WorkGuidance;
  action: NextAction | null;
  expanded: boolean;
  panelId: string;
  notice: string;
  toggleRef?: Ref<HTMLButtonElement>;
  onToggle: () => void;
  onNext: (action: NextAction) => void;
}

/** The one-row summary: the ring, the goal, the state, a few checkable facts, and the Next button. */
export function WhereAreWeBar({ facts, guidance, action, expanded, panelId, notice, toggleRef, onToggle, onNext }: WhereAreWeBarProps) {
  const goal = goalLine(guidance, facts);
  const state = stripState(facts);
  const line = factsLine(facts);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
      <button
        ref={toggleRef} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}
        className="flex min-w-0 flex-1 basis-64 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The counts are in the facts line, so the ring is left out of the accessible name. */}
        <ContextRing aria-hidden="true" size={RING_SIZE} milestones={ringMilestones(facts)} currentIndex={currentMilestoneIndex(facts)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-foreground" title={goal.text || undefined}>
            {goal.stage && <span className="font-normal capitalize text-muted-foreground">{goal.stage} &middot; </span>}
            {goal.text || <span className="font-normal text-muted-foreground">No goal set yet</span>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-tight text-muted-foreground">
            <span className="state-chip" data-tone={state.tone}>{state.label}</span>
            {line.map((fact) => <span key={fact}><span aria-hidden="true">&middot; </span>{fact}</span>)}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
      {action && (
        <Button
          size="xs" variant="ghost" className="max-w-full min-w-0 text-foreground" title={action.reason}
          aria-label={`Next: ${action.label}. ${action.reason}`}
          onClick={() => onNext(action)}
        >
          <span className="truncate">{action.label}</span>
          <ArrowRight aria-hidden="true" className="text-primary" />
        </Button>
      )}
      {/* Always present, so a screen reader hears the notice when it appears. Visible only while there is one. */}
      <span role="status" className={notice ? 'basis-full text-[11px] text-muted-foreground' : 'sr-only'}>{notice}</span>
    </div>
  );
}

export interface WhereAreWeStripProps {
  workspace: string;
  /** Whether this workspace is the one on screen. Hidden ones neither poll nor listen. */
  active: boolean;
  /** Types text into the chat prompt without sending it. False when the chat is not connected. */
  fillPrompt: (text: string) => boolean;
  openFile: (reference: { path: string; line?: number }) => void;
}

/**
 * Shows where the work stands, one click from the chat. A ring of milestones, the
 * goal, what needs the developer, and a Next button; the panel behind it lists
 * every milestone (any finished one can be reopened), open questions and touched
 * files. The AI can suggest things here, but only the developer acts on them, and
 * nothing here ever presses Enter in the chat.
 */
export function WhereAreWeStrip({ workspace, active, fillPrompt, openFile }: WhereAreWeStripProps) {
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState<'open' | 'milestones'>();
  const [notice, setNotice] = useState('');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const factsQuery = useProgressFacts(workspace, active);
  const guidanceQuery = useWorkGuidance(active ? workspace : null);
  const changesQuery = useWorkspaceChanges(workspace, active && expanded);
  const feed = useScreenFeed(workspace, active);
  const reopen = useReopenMilestone(workspace);
  const acknowledge = useAcknowledgeQuestions(workspace);
  const facts = factsQuery.data;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  // The assignment changes rarely, so it is read again when the panel opens rather than polled.
  const refetchGuidance = guidanceQuery.refetch;
  useEffect(() => { if (expanded) void refetchGuidance(); }, [expanded, refetchGuidance]);

  const action = useMemo(() => (facts ? nextAction(facts, latestNext(feed.events)) : null), [facts, feed.events]);
  const proposals = useMemo(() => (facts ? activeProposals(feed.events, facts, dismissed) : []), [facts, feed.events, dismissed]);

  const fill = (text: string) => {
    setNotice(fillPrompt(text) ? 'Added to the chat prompt. Press Enter to send it.' : 'The chat is not connected, so nothing was added.');
  };
  const runNext = (next: NextAction) => {
    if (next.kind === 'panel') { setSection(next.section); setExpanded(true); return; }
    if (next.target) openFile(next.target);
    fill(next.prompt);
  };

  if (!facts) {
    return (
      <section aria-label="Where are we" className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-muted-foreground">
          <ContextRing aria-hidden="true" size={RING_SIZE} milestones={[]} />
          {factsQuery.isError ? (
            <>
              <span role="status">Progress is unavailable{factsQuery.error instanceof ApiError ? ` (${factsQuery.error.message})` : ''}.</span>
              <Button size="xs" variant="ghost" onClick={() => { void factsQuery.refetch(); }}><RefreshCw aria-hidden="true" />Try again</Button>
            </>
          ) : <span role="status">Loading progress...</span>}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Where are we" className="relative shrink-0 border-b border-border bg-card"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return;
        // Keep Escape from also closing the code or documents panel, and give focus back to the strip.
        event.stopPropagation();
        setExpanded(false);
        toggleRef.current?.focus();
      }}
    >
      <WhereAreWeBar
        facts={facts} guidance={guidanceQuery.data} action={action} expanded={expanded} panelId={panelId} notice={notice} toggleRef={toggleRef}
        onToggle={() => { setSection(undefined); setExpanded((value) => !value); }} onNext={runNext}
      />
      {expanded && (
        <div id={panelId} role="region" aria-label="Progress details" className="absolute inset-x-0 top-full z-20 max-h-[min(70vh,32rem)] overflow-y-auto border-b border-border bg-card px-3 py-3 shadow-lg">
          <ProgressPanel
            id={panelId} facts={facts} guidance={guidanceQuery.data} proposals={proposals} focusSection={section}
            changes={changesQuery.data} changesError={changesQuery.isError ? 'Could not list the changed files.' : undefined}
            acknowledging={acknowledge.isPending}
            onReopen={async (stepId, reason) => {
              try { await reopen.mutateAsync({ stepId, reason }); return null; }
              catch (error) { return error instanceof Error ? error.message : 'Could not reopen the milestone.'; }
            }}
            onDismissProposal={(eventId) => setDismissed((current) => new Set(current).add(eventId))}
            onFill={fill} onOpenFile={openFile} onAcknowledge={() => acknowledge.mutate()}
          />
        </div>
      )}
    </section>
  );
}
