import { useMemo, type FormEvent, type Ref } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  LockKeyhole,
  MoreHorizontal,
  PackageCheck,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  UserRound,
  Users,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../../components/ui/menu.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { WorkroomParticipant, WorkroomSnapshot, WorkflowStepProgress } from '../../types.js';

export type WorkroomTool = 'overview' | 'context' | 'resources' | 'workflow' | 'members' | 'activity' | 'security';

interface HandoffStreamProps {
  snapshot: WorkroomSnapshot;
  roomUrl: string;
  isHost: boolean;
  me?: WorkroomParticipant;
  busy: string | null;
  message: string;
  hasUnsavedHandoffDraft: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onCreateInvite: () => void;
  onRefresh: () => void;
  onStopOrLeave: () => void;
  onOpenTool: (tool: WorkroomTool) => void;
  onMessageChange: (message: string) => void;
  onPostUpdate: (message: string) => Promise<boolean>;
}

const activityTools: Array<{ pattern: RegExp; label: string; tool: WorkroomTool }> = [
  { pattern: /plan|decision|context|document|handoff/i, label: 'Shared context', tool: 'context' },
  { pattern: /resource|package|skill|agent/i, label: 'Resource evidence', tool: 'resources' },
  { pattern: /workflow|step|completion|evidence/i, label: 'Workflow evidence', tool: 'workflow' },
  { pattern: /member|join|participant|invite/i, label: 'People', tool: 'members' },
  { pattern: /password|credential|security|certificate|tls/i, label: 'Security record', tool: 'security' },
];

const toolItems: Array<{ tool: WorkroomTool; label: string; icon: typeof Activity }> = [
  { tool: 'overview', label: 'Project & privacy', icon: ShieldCheck },
  { tool: 'context', label: 'Shared context', icon: FileText },
  { tool: 'resources', label: 'Resources', icon: PackageCheck },
  { tool: 'workflow', label: 'Workflow', icon: GitBranch },
  { tool: 'members', label: 'People', icon: Users },
  { tool: 'activity', label: 'Full activity log', icon: Activity },
  { tool: 'security', label: 'Security & export', icon: LockKeyhole },
];

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function displayRole(participant: WorkroomParticipant): string {
  return participant.role === 'host' ? 'host' : participant.role === 'publisher' ? 'publisher' : 'member';
}

function workflowStatusLabel(status: WorkflowStepProgress['status']): string {
  switch (status) {
    case 'in_progress': return 'In progress';
    case 'completion_proposed': return 'Review requested';
    case 'completed': return 'Complete';
    case 'skipped': return 'Skipped';
    default: return 'Pending';
  }
}

function WorkflowStatusIcon({ status }: { status: WorkflowStepProgress['status'] }) {
  if (status === 'completed') return <Check aria-hidden="true" className="text-success" size={14} />;
  if (status === 'in_progress') return <CircleDot aria-hidden="true" className="text-primary" size={14} />;
  if (status === 'completion_proposed') return <Clock3 aria-hidden="true" className="text-warning" size={14} />;
  return <Circle aria-hidden="true" className="text-muted-foreground" size={14} />;
}

function ParticipantMark({ participant, emphasized = false }: { participant?: WorkroomParticipant; emphasized?: boolean }) {
  return (
    <span aria-hidden="true" data-role={participant?.role ?? 'system'} className={`grid shrink-0 place-items-center rounded-full border ${emphasized ? 'size-9 border-primary/60 bg-primary/15 text-primary' : 'size-8 border-border bg-muted text-muted-foreground'}`}>
      <UserRound aria-hidden="true" size={emphasized ? 17 : 15} />
    </span>
  );
}

export function HandoffStream({
  snapshot,
  roomUrl,
  isHost,
  me,
  busy,
  message,
  hasUnsavedHandoffDraft,
  headingRef,
  onCreateInvite,
  onRefresh,
  onStopOrLeave,
  onOpenTool,
  onMessageChange,
  onPostUpdate,
}: HandoffStreamProps) {
  const participants = useMemo(() => snapshot.participants.filter((participant) => !participant.revokedAt), [snapshot.participants]);
  const participantById = useMemo(() => new Map(snapshot.participants.map((participant) => [participant.id, participant])), [snapshot.participants]);
  const workflow = snapshot.workflowProgress;
  const reviewStepIndex = workflow?.steps.findIndex((step) => step.status === 'completion_proposed') ?? -1;
  const inProgressStepIndex = workflow?.steps.findIndex((step) => step.status === 'in_progress') ?? -1;
  const activeStepIndex = reviewStepIndex >= 0 ? reviewStepIndex : inProgressStepIndex;
  const pendingStepIndex = workflow?.steps.findIndex((step) => step.status === 'pending') ?? -1;
  const activeStep = activeStepIndex >= 0 ? workflow?.steps[activeStepIndex] : undefined;
  const pendingStep = pendingStepIndex >= 0 ? workflow?.steps[pendingStepIndex] : undefined;
  const activeDefinition = workflow?.package.steps.find((candidate) => candidate.id === activeStep?.stepId);
  const pendingDefinition = workflow?.package.steps.find((candidate) => candidate.id === pendingStep?.stepId);
  const nextStep = activeStepIndex >= 0 ? workflow?.steps.slice(activeStepIndex + 1).find((step) => step.status === 'pending') : undefined;
  const nextDefinition = workflow?.package.steps.find((candidate) => candidate.id === nextStep?.stepId);
  const activeActor = activeStep ? participantById.get(activeStep.updatedBy) : undefined;
  const workflowComplete = Boolean(workflow?.steps.length && workflow.steps.every((step) => step.status === 'completed' || step.status === 'skipped'));
  const activity = snapshot.activity.slice(-20);

  const submitUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextMessage = message.trim();
    if (!nextMessage || busy !== null || hasUnsavedHandoffDraft) return;
    await onPostUpdate(nextMessage);
  };

  return (
    <section aria-labelledby="handoff-stream-title" className="animate-fade-in" data-testid="handoff-stream">
      <header className="border-b border-border pb-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 xl:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Activity aria-hidden="true" className="text-muted-foreground" size={17} />
              <h1 ref={headingRef} id="handoff-stream-title" tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">Handoff Stream</h1>
              <Badge variant="success"><span className="mr-1 inline-block size-1.5 rounded-full bg-success" />Live</Badge>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{snapshot.bundle.feature.goal}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
            <div aria-label={`${participants.length} participants`} className="flex items-center gap-1">
              {participants.slice(0, 4).map((participant) => (
                <span key={participant.id} className="flex items-center gap-2 rounded-md px-1 py-0.5" title={`${participant.displayName} · ${displayRole(participant)}`}>
                  <ParticipantMark participant={participant} emphasized={participant.id === me?.id} />
                  <span className="hidden max-w-24 leading-tight 2xl:block">
                    <span className="block truncate text-xs font-semibold">{participant.displayName}</span>
                    <span className="block text-[10px] text-muted-foreground">{displayRole(participant)}</span>
                  </span>
                </span>
              ))}
              {participants.length > 4 && <span className="grid size-8 place-items-center rounded-full border border-border bg-muted text-[10px] font-semibold text-muted-foreground">+{participants.length - 4}</span>}
            </div>
            {isHost && (
              <Button variant="outline" onClick={onCreateInvite} disabled={busy !== null}>
                <Link2 aria-hidden="true" /> Invite
                {snapshot.pendingJoins.length > 0 && <span className="ml-0.5 rounded bg-warning/15 px-1 text-[10px] text-warning-foreground">{snapshot.pendingJoins.length}</span>}
              </Button>
            )}
            <Menu>
              <MenuTrigger aria-label="Open room tools" className="grid size-8 cursor-pointer place-items-center rounded-md border border-border bg-card text-muted-foreground shadow-2xs transition-colors hover:bg-accent hover:text-foreground">
                <MoreHorizontal aria-hidden="true" size={16} />
              </MenuTrigger>
              <MenuPopup align="end" className="w-56">
                {toolItems.map(({ tool, label, icon: Icon }) => (
                  <MenuItem key={tool} onClick={() => onOpenTool(tool)}>
                    <Icon aria-hidden="true" /> {label}
                    {tool === 'members' && snapshot.pendingJoins.length > 0 && <span className="ml-auto text-[10px] text-warning-foreground">{snapshot.pendingJoins.length}</span>}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem onClick={onRefresh}><RefreshCw aria-hidden="true" /> Refresh room</MenuItem>
                <MenuItem
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => {
                    const action = isHost ? 'stop hosting this Workroom' : 'leave this Workroom';
                    if (window.confirm(`Are you sure you want to ${action}?`)) onStopOrLeave();
                  }}
                >
                  <Square aria-hidden="true" /> {isHost ? 'Stop room' : 'Leave room'}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-primary/35 bg-primary/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/50 bg-primary/12 text-primary">
                <GitBranch aria-hidden="true" size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {workflow ? workflowComplete ? 'Workflow complete' : activeStep?.status === 'completion_proposed' ? 'A review is ready' : activeStep ? 'Work is moving' : 'Workflow ready' : 'No shared workflow yet'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {workflowComplete
                    ? 'Every shared step has been completed.'
                    : workflow && activeStep
                    ? `${activeActor?.displayName || 'A participant'} updated ${activeDefinition?.title || activeStep.stepId} · step ${activeStepIndex + 1} of ${workflow.steps.length}${nextDefinition ? ` · next: ${nextDefinition.title}` : ''}`
                    : workflow && pendingStep
                      ? `Next: ${pendingDefinition?.title || pendingStep.stepId} · step ${pendingStepIndex + 1} of ${workflow.steps.length}`
                      : workflow
                        ? 'The shared workflow is ready to start.'
                        : isHost
                          ? 'Choose a reviewed workflow to make the next handoff explicit.'
                          : 'The host has not selected a shared workflow yet.'}
                </p>
              </div>
            </div>
            {(workflow || isHost) && (
              <Button size="sm" onClick={() => onOpenTool('workflow')}>
                {activeStep?.status === 'completion_proposed' ? 'Review proposal' : workflow ? 'Open workflow' : 'Set workflow'}
                <ChevronRight aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Room activity</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Decisions, evidence, and handoffs shared with this room.</p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => onOpenTool('activity')}>View log <ArrowRight aria-hidden="true" /></Button>
            </div>

            {activity.length > 0 ? (
              <ol aria-label="Workroom activity" className="relative divide-y divide-border/70 before:absolute before:bottom-8 before:left-[2.05rem] before:top-8 before:w-px before:bg-border">
                {activity.map((event) => {
                  const actor = participantById.get(event.actorId);
                  const related = activityTools.find(({ pattern }) => pattern.test(event.type));
                  return (
                    <li key={event.sequence} className="relative flex gap-3 px-4 py-4 sm:gap-4">
                      <span className="relative z-10 rounded-full bg-card p-0.5"><ParticipantMark participant={actor} emphasized={actor?.id === me?.id} /></span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 break-words text-xs font-semibold [overflow-wrap:anywhere]">{actor?.displayName || 'Historical participant'}</span>
                          {actor && <Badge variant={actor.role === 'host' ? 'info' : 'secondary'}>{displayRole(actor)}</Badge>}
                          <time className="text-[10px] text-muted-foreground" dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
                        </div>
                        <p className="mt-1.5 break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">{event.summary}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{event.type} · event #{event.sequence}</p>
                        {related && (
                          <button
                            type="button"
                            className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/35 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            onClick={() => onOpenTool(related.tool)}
                          >
                            <FileText aria-hidden="true" size={12} /> {related.label}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="px-4 py-10 text-center">
                <Activity aria-hidden="true" className="mx-auto text-muted-foreground" size={20} />
                <p className="mt-2 text-sm font-medium">No shared activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Post an update below to begin the handoff stream.</p>
              </div>
            )}

            <form className="border-t border-border p-3" onSubmit={submitUpdate}>
              <label className="sr-only" htmlFor="handoff-stream-message">Share a handoff update</label>
              <Textarea
                id="handoff-stream-message"
                className="min-h-20 resize-y border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
                maxLength={4_000}
                placeholder="Share a decision, result, blocker, or next step…"
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.form?.requestSubmit();
                }}
              />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-[10px] text-muted-foreground">Only the text you enter is shared from this composer. No files, diffs, paths, credentials, or transcripts are collected automatically.</p>
                  {hasUnsavedHandoffDraft && <p className="text-[10px] text-warning-foreground">Resolve your unsaved Handoff draft in Shared context before posting another update.</p>}
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {hasUnsavedHandoffDraft && <Button type="button" variant="ghost" size="sm" onClick={() => onOpenTool('context')}>Review draft</Button>}
                  <Button type="submit" size="sm" disabled={!message.trim() || busy !== null || hasUnsavedHandoffDraft}>
                    <Send aria-hidden="true" /> {busy === 'stream-post' ? 'Posting…' : 'Post update'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <aside aria-label="Workroom details" className="h-fit divide-y divide-border rounded-lg border border-border bg-card xl:sticky xl:top-4">
          <section className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold">Steps {workflow ? `(${workflow.steps.length})` : ''}</h2>
              {(workflow || isHost) && <button type="button" onClick={() => onOpenTool('workflow')} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Open workflow tools"><Settings2 aria-hidden="true" size={14} /></button>}
            </div>
            {workflow ? (
              <ol className="mt-3 space-y-1">
                {workflow.steps.map((step, index) => {
                  const definition = workflow.package.steps.find((candidate) => candidate.id === step.stepId);
                  const updater = participantById.get(step.updatedBy);
                  const statusLabel = workflowStatusLabel(step.status);
                  return (
                    <li key={step.stepId}>
                      <button type="button" onClick={() => onOpenTool('workflow')} className="group flex w-full cursor-pointer items-start gap-2 rounded-md px-1 py-2 text-left hover:bg-accent/60">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border bg-background text-[10px]">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-xs ${step.status === 'in_progress' || step.status === 'completion_proposed' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{definition?.title || step.stepId}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{step.status === 'pending' || !updater ? statusLabel : `${statusLabel} · updated by ${updater.displayName}`}</span>
                        </span>
                        <span className="mt-1"><WorkflowStatusIcon status={step.status} /></span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : isHost ? (
              <button type="button" onClick={() => onOpenTool('workflow')} className="mt-3 w-full cursor-pointer rounded-md border border-dashed border-border px-3 py-4 text-left hover:bg-accent/50">
                <span className="text-xs font-medium">Make turns explicit</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">Select a shared workflow and require evidence for completion.</span>
              </button>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4">
                <span className="text-xs font-medium">Waiting for a workflow</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">The host can select a shared workflow for this room.</span>
              </div>
            )}
          </section>

          <section className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold">Participants ({participants.length})</h2>
              <button type="button" onClick={() => onOpenTool('members')} className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Manage</button>
            </div>
            <ul className="mt-3 space-y-2.5">
              {participants.slice(0, 6).map((participant) => (
                <li key={participant.id} className="flex items-center gap-2">
                  <ParticipantMark participant={participant} emphasized={participant.id === me?.id} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{participant.displayName}</span>
                  <span className="text-[10px] text-muted-foreground">{displayRole(participant)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2.5 p-4">
            <h2 className="text-xs font-semibold">Room details</h2>
            <dl className="space-y-2 text-[11px]">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Created by</dt><dd className="truncate text-right">{snapshot.participants.find((participant) => participant.role === 'host')?.displayName || 'Host'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Created</dt><dd className="text-right">{formatDate(snapshot.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Workspace</dt><dd className="truncate text-right">{snapshot.bundle.feature.id}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd className="inline-flex items-center gap-1.5">Live <span className="size-1.5 rounded-full bg-success" /></dd></div>
            </dl>
            <p className="truncate border-t border-border pt-2 font-mono text-[9px] text-muted-foreground" title={roomUrl}>{roomUrl}</p>
          </section>

          <section className="p-3">
            <Button variant="ghost" className="w-full justify-start" onClick={() => onOpenTool('security')}>
              <ShieldCheck aria-hidden="true" /> Security & encrypted export
            </Button>
          </section>
        </aside>
      </div>
    </section>
  );
}
