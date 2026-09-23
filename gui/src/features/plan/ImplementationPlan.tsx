import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  FileText,
  Code,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Lock,
  PlayCircle,
  GitBranch,
  Play,
  Check,
  Workflow,
  Radio,
  User,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { apiFetch } from '../../lib/api/client.js';
import type { WorkspaceLifecycle, WorkspaceVerificationReport } from '../../types.js';

interface ImplementationPlanProps {
  planContent: string;
  planLoading: boolean;
  planError: string | null;
  handleRetryPlan: (wsId: string) => Promise<void>;
  workspaceId?: string;
  defaultViewMode?: 'flow' | 'preview' | 'raw';
}

export const ImplementationPlan: React.FC<ImplementationPlanProps> = ({
  planContent,
  planLoading,
  planError,
  handleRetryPlan,
  workspaceId,
  defaultViewMode = 'flow',
}) => {
  const [viewMode, setViewMode] = useState<'flow' | 'preview' | 'raw'>(defaultViewMode);
  const [milestoneMarkdown, setMilestoneMarkdown] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<WorkspaceLifecycle | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ status: string; text: string } | null>(null);
  const [verificationReport, setVerificationReport] = useState<WorkspaceVerificationReport | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isFleetExpanded, setIsFleetExpanded] = useState(false);

  useEffect(() => {
    if (defaultViewMode) {
      setViewMode(defaultViewMode);
    }
  }, [defaultViewMode]);

  const loadLifecycle = useCallback(async () => {
    if (!workspaceId) return;
    setLifecycleLoading(true);
    try {
      const data = await apiFetch<{ lifecycle: WorkspaceLifecycle; report?: WorkspaceVerificationReport | null; plan?: string }>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/lifecycle`,
      );
      setLifecycle(data.lifecycle);
      if (data.plan !== undefined) setMilestoneMarkdown(data.plan);
      if (data.report !== undefined) setVerificationReport(data.report);
    } catch (error) {
      // Missing lifecycle state is normal for newly initialized or test workspaces.
      console.warn('Could not load workspace lifecycle:', error);
    } finally {
      setLifecycleLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setMilestoneMarkdown(null);
    setVerificationReport(null);
    setVerifyMessage(null);
    void loadLifecycle();
  }, [loadLifecycle]);

  const handleVerify = async () => {
    if (!workspaceId) return;
    setVerifying(true);
    setVerifyMessage(null);
    try {
      const data = await apiFetch<{ report: WorkspaceVerificationReport }>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/verify`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const report = data.report;
      setVerificationReport(report);
      const messages: Record<WorkspaceVerificationReport['overallStatus'], string> = {
        pass: `Tests passed (${(report.durationMs / 1000).toFixed(1)}s, ${report.repos.length} repositories). Use Verify & Complete on the active gate to advance.`,
        pass_dirty: report.canProgress
          ? 'Tests passed with uncommitted changes. Review the changes before continuing.'
          : 'Tests passed with uncommitted changes. Commit them and rerun verification before advancing.',
        'no-tests': 'No test command was found. Configure a verification command for this workspace and run it again.',
        timeout: 'Verification timed out. Check the command and output below, then retry.',
        fail: 'Verification failed. Review the repository details below, fix the problem, and retry.',
        skipped: 'Verification was skipped. Run verification before relying on a test result.',
      };
      setVerifyMessage({ status: report.overallStatus, text: messages[report.overallStatus] });
      await loadLifecycle();
    } catch (err: any) {
      setVerifyMessage({ status: 'fail', text: `Verification failed: ${err.message}` });
    } finally {
      setVerifying(false);
    }
  };

  const handleStepAction = async (stepId: string, action: 'start' | 'verify' | 'complete') => {
    if (!workspaceId) return;
    setActionLoading(stepId);
    setVerifyMessage(null);
    try {
      const data = await apiFetch<{ lifecycle: WorkspaceLifecycle }>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/lifecycle/step`,
        {
          method: 'POST',
          body: JSON.stringify({ stepId, action }),
        },
      );
      setLifecycle(data.lifecycle);
      await loadLifecycle();
    } catch (error) {
      setVerifyMessage({ status: 'fail', text: error instanceof Error ? error.message : 'Unable to advance lifecycle.' });
      await loadLifecycle();
    } finally {
      setActionLoading(null);
    }
  };

  const milestoneMarker = /<!-- CONTEXTSPACE:MILESTONES:START -->[\s\S]*?<!-- CONTEXTSPACE:MILESTONES:END -->/;
  const currentPlanContent = milestoneMarkdown !== null
    ? milestoneMarker.test(planContent) ? planContent.replace(milestoneMarker, () => milestoneMarkdown) : `${milestoneMarkdown}\n\n${planContent}`
    : planContent;

  if (!lifecycle?.steps.length) return null;

  return (
    <div className="rounded-xl border border-border/80 bg-card/70 backdrop-blur-md p-5 shadow-xs">
      <header className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Workflow size={18} className="text-primary" />
          <h4 className="text-sm font-bold text-foreground">
            Lifecycle Flow & Implementation Plan
          </h4>
          {lifecycle && (
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">
              {lifecycle.flowType} flow
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-md border border-border/60">
            <Button
              size="xs"
              variant={viewMode === 'flow' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('flow')}
              className="text-[11px] gap-1 px-2.5 font-medium"
            >
              <Workflow size={12} /> Visual Flow
            </Button>
            <Button
              size="xs"
              variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('preview')}
              className="text-[11px] gap-1 px-2.5"
            >
              <FileText size={12} /> Markdown Plan
            </Button>
            <Button
              size="xs"
              variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('raw')}
              className="text-[11px] gap-1 px-2"
            >
              <Code size={12} /> Raw
            </Button>
          </div>
        </div>
      </header>

      {/* Verification Flash Message */}
      {verifyMessage && (
        <div
          role="status"
          className={`mb-4 flex items-center justify-between p-3 rounded-lg text-xs font-medium border ${
            verifyMessage.status === 'pass'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : ['pass_dirty', 'no-tests', 'skipped'].includes(verifyMessage.status)
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {verifyMessage.status === 'pass' ? (
              <CheckCircle2 size={15} />
            ) : ['pass_dirty', 'no-tests', 'skipped'].includes(verifyMessage.status) ? (
              <AlertTriangle size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
            <span>{verifyMessage.text}</span>
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setVerifyMessage(null)}
            className="text-[10px] h-6 px-1.5"
          >
            Dismiss
          </Button>
        </div>
      )}

      {verificationReport && (
        <details className="mb-4 rounded-lg border border-border p-3 text-xs" open={verificationReport.overallStatus !== 'pass'}>
          <summary className="cursor-pointer font-medium">Verification details ({verificationReport.overallStatus.replaceAll('_', ' ')})</summary>
          {verificationReport.repos.map((repo, index) => (
            <div key={`${repo.repoName}-${index}`} className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="font-semibold">{repo.repoName}: {repo.status.replaceAll('_', ' ')}</p>
              <p className="font-mono break-all">{repo.command}{repo.exitCode !== null ? ` — exit code ${repo.exitCode}` : ''}</p>
              {repo.status === 'no-tests' && <p>No test command found. Configure a workspace verification command.</p>}
              {repo.status === 'timeout' && <p>The command exceeded its time limit. Check for a stalled test or split the suite, then retry.</p>}
              {repo.error && <p className="text-destructive">{repo.error}</p>}
              {(repo.stdout || repo.stderr) && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3">{[repo.stdout, repo.stderr].filter(Boolean).join('\n')}</pre>
              )}
            </div>
          ))}
        </details>
      )}

      {/* Plan Load Error Alert */}
      {planError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{planError}</span>
          </div>
          {workspaceId && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void handleRetryPlan(workspaceId)}
              disabled={planLoading}
            >
              <RefreshCw size={11} className={planLoading ? 'animate-spin' : ''} /> Retry load
            </Button>
          )}
        </div>
      )}

      {/* VISUAL FLOW MODE */}
      {viewMode === 'flow' ? (
        <div className="space-y-6">
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Active Step:</span>
              <span className="font-mono text-primary bg-primary/10 px-2 py-0.5 rounded text-[11px]">
                {lifecycle?.currentStepId ?? 'none'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => void loadLifecycle()}
                disabled={lifecycleLoading}
                className="gap-1 text-xs"
              >
                <RefreshCw size={12} className={lifecycleLoading ? 'animate-spin' : ''} />
                Refresh Radar
              </Button>

              <Button
                size="xs"
                variant="default"
                onClick={() => void handleVerify()}
                disabled={verifying || actionLoading !== null}
                className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                <ShieldCheck size={14} className={verifying ? 'animate-spin' : ''} />
                {verifying ? 'Running Tests...' : 'Run Mechanical Gate'}
              </Button>
            </div>
          </div>

          {/* Stepper Pipeline */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Vertical Slices & Milestones
            </div>

            <div className="grid gap-3">
              {lifecycle?.steps.map((step, idx) => {
                const isCurrent = step.id === lifecycle.currentStepId;
                const requiresVerification = step.requiresVerification || step.verificationCommand || step.lastVerificationStatus ||
                  ['verify_and_ship', 'step_verification', 'epic_slice_4'].includes(step.id);
                return (
                  <div
                    key={step.id}
                    className={`relative p-4 rounded-xl border transition-all ${
                      step.status === 'completed'
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : step.status === 'verified'
                        ? 'border-cyan-500/40 bg-cyan-500/5'
                        : isCurrent || step.status === 'in_progress'
                        ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-xs'
                        : step.status === 'blocked'
                        ? 'border-border/40 bg-muted/10 opacity-75'
                        : 'border-border/70 bg-card/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {step.status === 'completed' ? (
                            <CheckCircle2 size={18} className="text-emerald-400" />
                          ) : step.status === 'verified' ? (
                            <ShieldCheck size={18} className="text-cyan-400" />
                          ) : step.status === 'in_progress' ? (
                            <PlayCircle size={18} className="text-primary animate-pulse" />
                          ) : step.status === 'blocked' ? (
                            <Lock size={18} className="text-muted-foreground/60" />
                          ) : (
                            <Clock size={18} className="text-amber-400/80" />
                          )}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground">
                              Slice {idx + 1}:
                            </span>
                            <h5 className="text-sm font-semibold text-foreground">
                              {step.title}
                            </h5>
                            {step.status === 'blocked' && <p className="w-full text-xs text-amber-500">Blocked: {step.unblockCondition || (step.dependsOn?.length ? `Complete ${step.dependsOn.map((id) => lifecycle.steps.find((item) => item.id === id)?.title ?? id).join(', ')}.` : 'Set an unblock condition in Edit milestones.')}</p>}
                            {step.owner && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                                <User size={10} /> {step.owner}
                              </span>
                            )}
                            {step.repo && <span className="text-xs text-muted-foreground">Repo: {step.repo}</span>}
                            {step.workItem && <span className="text-xs text-muted-foreground break-all">Work item / PR: {step.workItem}</span>}
                            {step.branch && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20">
                                <GitBranch size={10} /> {step.branch}
                              </span>
                            )}
                          </div>

                          {step.description && (
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                              {step.description}
                            </p>
                          )}

                          {step.dependsOn && step.dependsOn.length > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                              <span className="font-semibold">Depends on:</span>
                              {step.dependsOn.map((dep) => (
                                <span
                                  key={dep}
                                  className="px-1.5 py-0.2 bg-muted/60 rounded text-[10px] font-mono"
                                >
                                  {dep}
                                </span>
                              ))}
                            </div>
                          )}

                          {step.lastVerificationStatus && (
                            <div className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded border ${step.lastVerificationStatus === 'pass' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                              <ShieldCheck size={12} />
                              <span>Gate: {step.lastVerificationStatus.toUpperCase()}</span>
                              {step.lastVerificationSha && (
                                <span className="font-mono text-[10px] opacity-80">
                                  @{step.lastVerificationSha.slice(0, 7)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {(step.status === 'in_progress' || step.status === 'verified') && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void handleStepAction(step.id, 'complete')}
                            disabled={verifying || actionLoading !== null}
                            className="text-[11px] gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                          >
                            <Check size={12} /> {actionLoading === step.id ? 'Working...' : requiresVerification ? 'Verify & Complete' : 'Mark Complete'}
                          </Button>
                        )}
                        {step.status === 'pending' && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void handleStepAction(step.id, 'start')}
                            disabled={verifying || actionLoading !== null}
                            className="text-[11px] gap-1 text-primary hover:bg-primary/10"
                          >
                            <Play size={12} /> Start
                          </Button>
                        )}
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                            step.status === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : step.status === 'verified'
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : step.status === 'in_progress'
                              ? 'bg-primary/20 text-primary'
                              : step.status === 'blocked'
                              ? 'bg-muted/40 text-muted-foreground'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {step.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sister Branch Fleet Radar */}
          {lifecycle?.fleet && lifecycle.fleet.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFleetExpanded((prev) => !prev)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider cursor-pointer"
                    aria-expanded={isFleetExpanded}
                    aria-controls="sister-branch-fleet-list"
                  >
                    <Radio size={14} className="text-cyan-400" />
                    <span>Sister Branch Fleet & Collaborator Radar</span>
                  </button>
                  <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 h-4.5">
                    {lifecycle.fleet.length} {lifecycle.fleet.length === 1 ? 'branch' : 'branches'}
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-[11px] text-muted-foreground">
                    Tracking origin remote references
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setIsFleetExpanded((prev) => !prev)}
                    className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                    title={isFleetExpanded ? 'Collapse fleet' : 'Expand fleet'}
                    aria-expanded={isFleetExpanded}
                    aria-controls="sister-branch-fleet-list"
                  >
                    {isFleetExpanded ? (
                      <>
                        <ChevronDown size={13} />
                        <span>Collapse</span>
                      </>
                    ) : (
                      <>
                        <ChevronRight size={13} />
                        <span>Expand</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {isFleetExpanded && (
                <div id="sister-branch-fleet-list" className="grid gap-2">
                  {lifecycle.fleet.map((member) => (
                    <div
                      key={`${member.repoName}:${member.branch}`}
                      className={`flex flex-wrap items-center justify-between p-3 rounded-lg border text-xs ${
                        member.isCurrent
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border/60 bg-card/30'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`size-2 rounded-full shrink-0 ${
                            member.isCurrent ? 'bg-emerald-400 ring-4 ring-emerald-400/20' : 'bg-cyan-400'
                          }`}
                        />
                        <span className="font-mono font-semibold text-foreground">
                          {member.branch}
                        </span>
                        {member.repoName && new Set(lifecycle?.fleet?.map((m) => m.repoName)).size > 1 && (
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.2 rounded border border-border/40">
                            {member.repoName}
                          </span>
                        )}
                        {member.isCurrent && (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-primary/20 text-primary">
                            active worktree
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-muted-foreground">
                        <span className="font-mono text-[11px]">
                          +{member.ahead} / -{member.behind}
                        </span>
                        {member.lastCommitAuthor && (
                          <span className="text-[11px] text-foreground/80">
                            {member.lastCommitAuthor}
                            {member.lastCommitDate && (
                              <span className="text-muted-foreground ml-1">
                                ({Number.isNaN(Date.parse(member.lastCommitDate)) ? 'Date unavailable — reload flow' : new Date(member.lastCommitDate).toLocaleString()})
                              </span>
                            )}
                          </span>
                        )}
                        {member.lastCommitMessage && (
                          <span className="truncate max-w-[240px] text-muted-foreground italic text-[11px]">
                            "{member.lastCommitMessage}"
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* MARKDOWN / RAW PREVIEW MODE */
        <div>
          {planLoading && !currentPlanContent ? (
            <div className="flex justify-center py-10">
              <RefreshCw className="animate-spin text-primary" size={20} />
            </div>
          ) : !currentPlanContent ? (
            <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
              No implementation plan generated yet.
            </div>
          ) : viewMode === 'preview' ? (
            <div className="max-h-[550px] overflow-auto rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4">
              <ChatMarkdown content={currentPlanContent} />
            </div>
          ) : (
            <div className="max-h-[550px] overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {currentPlanContent}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
