import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { ArrowRight, Check, ChevronDown, MessageCircleQuestion, RefreshCw } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { ContextRing } from '../../components/ui/context-ring.js';
import { IconButton } from '../../components/ui/icon-button.js';
import { ApiError } from '../../lib/api/client.js';
import { useAcknowledgeQuestions, useProgressFacts, useReopenMilestone, useWorkGuidance, useWorkspaceChanges } from '../../lib/api/queries.js';
import { cn } from '../../lib/utils.js';
import type { OpenQuestion, ProgressFacts, WorkGuidance } from '../../types.js';
import { ProgressPanel } from './ProgressPanel.js';
import { activeProposals, answersQuestion, currentMilestoneIndex, factsLine, freshReveals, goalLine, latestNext, nextAction, ringMilestones, stripState, type NextAction } from './progressView.js';
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
          <span className="block truncate text-[13px] font-medium leading-tight text-foreground" title={goal.full ?? (goal.text || undefined)}>
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

export interface AnswerBarProps {
  /** The newest question the AI is waiting on. */
  question: OpenQuestion;
  /** How many older ones are still open. */
  earlier: number;
  acknowledging: boolean;
  onFill: (text: string) => void;
  onAcknowledge: () => void;
  onShowAll: () => void;
}

/**
 * What the AI is waiting for, in plain sight above the chat, with its suggested answers one click away. A suggested
 * answer is typed into the prompt and the developer presses Enter; the line they send closes the question, so there
 * is nothing else to mark. The check is for an answer given some other way.
 */
export function AnswerBar({ question, earlier, acknowledging, onFill, onAcknowledge, onShowAll }: AnswerBarProps) {
  const options = question.options ?? [];
  return (
    <div role="group" aria-label="The AI is waiting for your answer" className="flex items-start gap-2.5 border-t border-[color-mix(in_oklab,var(--state-needs)_45%,transparent)] bg-[color-mix(in_oklab,var(--state-needs)_7%,var(--card))] px-3 py-2">
      <MessageCircleQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--state-needs)]" />
      <div className="min-w-0 flex-1">
        {/* The agent wrote this: plain text only. */}
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">{question.message}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {options.length > 0 && (
            <div role="group" aria-label="Suggested answers" className="flex flex-wrap gap-1.5">
              {options.map((option) => (
                <Button key={option} size="xs" variant="outline" title="Adds this to the chat prompt. You press Enter." onClick={() => onFill(option)}>{option}</Button>
              ))}
            </div>
          )}
          <span className="text-[11px] text-muted-foreground">
            {options.length > 0 ? 'Pick one and press Enter, or type your own answer in the chat.' : 'Type your answer in the chat and press Enter.'}
          </span>
          {earlier > 0 && (
            <button type="button" onClick={onShowAll} className="cursor-pointer text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
              {earlier === 1 ? '1 earlier question' : `${earlier} earlier questions`}
            </button>
          )}
        </div>
      </div>
      <IconButton label="I answered in the chat" icon={<Check />} disabled={acknowledging} onClick={onAcknowledge} />
    </div>
  );
}

export interface WhereAreWeStripProps {
  workspace: string;
  /** Whether this workspace is the one on screen. Hidden ones neither poll nor listen. */
  active: boolean;
  /** Types text into the chat prompt without sending it. False when the chat is not connected. */
  fillPrompt: (text: string) => boolean;
  /** Set by the strip: called with the CLI's target when the developer sends a line to it in this chat. */
  replyRef?: { current: ((target: string) => void) | null };
  openFile: (reference: { path: string; line?: number }) => void;
}

/**
 * Shows where the work stands, one click from the chat. A ring of milestones, the
 * goal, what needs the developer, and a Next button; the panel behind it lists
 * every milestone (any finished one can be reopened), open questions and touched
 * files. The AI can suggest things here, but only the developer acts on them, and
 * nothing here ever presses Enter in the chat.
 */
export function WhereAreWeStrip({ workspace, active, fillPrompt, replyRef, openFile }: WhereAreWeStripProps) {
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

  // The questions still open, oldest first, unless they could not be read.
  const questions = useMemo(() => (facts && !facts.unavailable.some((entry) => entry.source === 'questions') ? facts.openQuestions : []), [facts]);
  // A line the developer sends to the assistant is their reply, so it closes what the AI asked. Read through refs:
  // the terminal calls this from its key handler, long after this render.
  const openQuestions = useRef<readonly OpenQuestion[]>([]);
  useEffect(() => { openQuestions.current = questions; }, [questions]);
  const acknowledgeMutate = acknowledge.mutate;
  useEffect(() => {
    if (!replyRef) return;
    replyRef.current = (target) => {
      const open = openQuestions.current;
      if (!answersQuestion(target, open)) return;
      openQuestions.current = [];
      acknowledgeMutate(undefined, {
        onSuccess: () => setNotice('Your reply answered the question.'),
        // Still open, so the next line the developer sends tries again.
        onError: () => {
          if (openQuestions.current.length === 0) openQuestions.current = open;
          setNotice('Your reply could not be recorded as the answer. Your next reply tries again.');
        },
      });
    };
    return () => { replyRef.current = null; };
  }, [replyRef, acknowledgeMutate]);

  // What the AI shows, or notes on a line, opens beside the chat as it arrives; what the stream replays from before does not.
  const revealSince = useRef(0);
  const revealed = useRef(new Set<string>());
  const openFileRef = useRef(openFile);
  useEffect(() => { openFileRef.current = openFile; });
  useEffect(() => { revealSince.current = Date.now(); revealed.current = new Set(); }, [workspace, active]);
  useEffect(() => {
    for (const reveal of freshReveals(feed.events, revealSince.current, revealed.current)) {
      revealed.current.add(reveal.id);
      openFileRef.current(reveal.target);
    }
  }, [feed.events]);

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
      {questions.length > 0 && (
        <AnswerBar
          question={questions[questions.length - 1]!} earlier={questions.length - 1} acknowledging={acknowledge.isPending}
          onFill={fill} onAcknowledge={() => acknowledge.mutate()} onShowAll={() => { setSection('open'); setExpanded(true); }}
        />
      )}
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
