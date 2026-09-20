/**
 * ProcessCockpitHeader Component: 2-tier compact header (60px total: L0 32px + L1 28px)
 * Delivering instant situational awareness: Bifocal Workspace & Worktree titles,
 * Git telemetry badges, Verification Gate Proof, Diff mode switch, Zen toggle,
 * and clickable Epic Iteration pills.
 * File: gui/src/app/ProcessCockpitHeader.tsx
 */
import React, { useState, useCallback } from 'react';
import {
  GitBranch,
  Target,
  Copy,
  Check,
  Lock,
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  Maximize2,
  Minimize2,
  Columns2,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { safeCopyToClipboard } from '../lib/clipboard.js';
import type { WorktreeDescriptor } from '../features/worktrees/types.js';
import type {
  DevelopmentIteration,
  CockpitStage,
  DiffViewMode,
  VerificationGateTelemetry,
} from '../features/cockpit/cockpitStore.js';

export interface ProcessCockpitHeaderProps {
  workspaceTitle: string;
  workspaceDescription?: string;
  activeWorktree?: WorktreeDescriptor | null;
  iterations: DevelopmentIteration[];
  activeIterationId: string | null;
  onSelectIteration: (iterationId: string) => void;
  activeStage: CockpitStage;
  onSelectStage: (stage: CockpitStage) => void;
  diffViewMode: DiffViewMode;
  onToggleDiffMode: () => void;
  isZenMode: boolean;
  onToggleZenMode: () => void;
  gateStatus?: VerificationGateTelemetry;
  onNewIteration?: () => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const ProcessCockpitHeader: React.FC<ProcessCockpitHeaderProps> = ({
  workspaceTitle,
  workspaceDescription,
  activeWorktree,
  iterations,
  activeIterationId,
  onSelectIteration,
  activeStage,
  onSelectStage,
  diffViewMode,
  onToggleDiffMode,
  isZenMode,
  onToggleZenMode,
  gateStatus = { overallStatus: 'idle', summaryText: 'No verification gate run yet' },
  onNewIteration,
  showToast,
}) => {
  const [copiedBranch, setCopiedBranch] = useState(false);

  const handleCopyBranch = useCallback(
    async (branch: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await safeCopyToClipboard(branch);
      if (ok) {
        setCopiedBranch(true);
        showToast?.(`Copied branch "${branch}" to clipboard`, 'success');
        setTimeout(() => setCopiedBranch(false), 1500);
      }
    },
    [showToast]
  );

  const shortSha = activeWorktree?.commitInfo?.shortSha || activeWorktree?.commitSha?.slice(0, 7) || 'unknown';

  return (
    <header className="w-full shrink-0 border-b border-border/80 bg-card/85 backdrop-blur-md z-20 select-none">
      {/* ─── L0: AMBIENT CONTEXT BAR (32px) ─────────────────────────────────── */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border/60 text-xs">
        {/* Left: Bifocal Breadcrumb & Intent */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Workspace Semantic Title */}
          <div
            className="font-semibold text-foreground tracking-tight truncate max-w-[240px] cursor-default"
            title={workspaceDescription || workspaceTitle}
          >
            {workspaceTitle}
          </div>

          <ChevronRight size={11} className="text-muted-foreground/40 shrink-0" />

          {/* Active Worktree Semantic Title & Branch Telemetry */}
          {activeWorktree ? (
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="font-medium text-foreground truncate max-w-[280px] flex items-center gap-1 text-xs"
                title={activeWorktree.intent || activeWorktree.title}
              >
                <Target size={12} className="text-primary shrink-0" />
                {activeWorktree.title}
              </span>

              {/* Technical Git Branch Slug */}
              <button
                type="button"
                onClick={(e) => handleCopyBranch(activeWorktree.branchName, e)}
                title="Click to copy branch"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground bg-muted/60 hover:bg-muted/90 px-1.5 py-0.5 rounded border border-border/50 hover:border-primary/40 transition-colors cursor-pointer"
              >
                <GitBranch size={10} className="text-primary/70 shrink-0" />
                <span className="truncate max-w-[150px]">{activeWorktree.branchName}</span>
                {copiedBranch ? (
                  <Check size={10} className="text-emerald-400 shrink-0" />
                ) : (
                  <Copy size={9} className="opacity-50 shrink-0" />
                )}
              </button>

              {/* Commit SHA */}
              <span
                className="font-mono text-[10px] text-muted-foreground/70 hidden sm:inline"
                title={`Head commit: ${activeWorktree.commitInfo?.commitMessage || activeWorktree.commitSha}`}
              >
                @{shortSha}
              </span>

              {/* Dirty / Clean Telemetry */}
              {activeWorktree.dirtyFilesCount === null ? (
                <span className="text-muted-foreground">Status unavailable</span>
              ) : activeWorktree.dirtyFilesCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectStage('diff')}
                  className="font-mono text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer hover:bg-amber-500/25 transition-colors"
                  title="View uncommitted modified files"
                >
                  <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>±{activeWorktree.dirtyFilesCount} dirty</span>
                </button>
              ) : (
                <span className="font-mono text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>clean</span>
                </span>
              )}

              {/* Worktree Lock Flag */}
              {activeWorktree.isPinned && (
                <span
                  className="inline-flex items-center gap-0.5 font-mono text-[10px] text-primary/80 bg-primary/10 px-1 py-0.5 rounded"
                  title="Worktree locked against pruning"
                >
                  <Lock size={10} />
                  <span>pinned</span>
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs italic">No active worktree</span>
          )}
        </div>

        {/* Right: Telemetry Proofs & Review Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Mechanical Verification Gate Indicator */}
          {gateStatus && (
            <div
              className={cn(
                'inline-flex items-center gap-1 font-mono text-[10px] font-semibold px-2 py-0.5 rounded border',
                gateStatus.overallStatus === 'pass'
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                  : gateStatus.overallStatus === 'fail'
                    ? 'border-rose-500/30 bg-rose-500/15 text-rose-400 animate-pulse'
                    : gateStatus.overallStatus === 'running'
                      ? 'border-sky-500/25 bg-sky-500/10 text-sky-400'
                      : 'border-border/60 bg-muted/20 text-muted-foreground'
              )}
              title={gateStatus.summaryText || 'Automated verification gate proof'}
            >
              {gateStatus.overallStatus === 'pass' ? (
                <CheckCircle2 size={11} className="text-emerald-400" />
              ) : gateStatus.overallStatus === 'fail' ? (
                <AlertCircle size={11} className="text-rose-400" />
              ) : gateStatus.overallStatus === 'running' ? (
                <Clock size={11} className="text-sky-400 animate-spin" />
              ) : (
                <Clock size={11} className="text-muted-foreground/60" />
              )}
              <span>
                Gate:{' '}
                {gateStatus.overallStatus === 'pass'
                  ? `PASS (${gateStatus.durationMs ?? 120}ms)`
                  : gateStatus.overallStatus === 'fail'
                    ? 'FAILED ✗'
                    : gateStatus.overallStatus === 'running'
                      ? 'RUNNING…'
                      : 'IDLE ○'}
              </span>
            </div>
          )}

          {/* Diff Mode Toggle (Side-by-Side ⇄ Unified) */}
          <button
            type="button"
            onClick={onToggleDiffMode}
            className="inline-flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Toggle Diff Mode (Split / Unified)"
          >
            <Columns2 size={11} />
            <span>{diffViewMode === 'side-by-side' ? 'Split' : 'Unified'}</span>
          </button>

          {/* Zen Mode Toggle (Collapses Left Panel & Ribbon) */}
          <button
            type="button"
            onClick={onToggleZenMode}
            className={cn(
              'inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer',
              isZenMode
                ? 'border-primary/40 bg-primary/10 text-primary font-bold'
                : 'border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
            title="Toggle Zen Review Mode (Shortcut: z)"
          >
            {isZenMode ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            <span>Zen (z)</span>
          </button>
        </div>
      </div>

      {/* ─── L1: MACRO ITERATIONS RIBBON (28px) ─────────────────────────────── */}
      {!isZenMode && (
        <div className="h-7 px-3 flex items-center justify-between border-b border-border/40 bg-muted/20 text-xs">
          {/* Left: Scrollable Iterations Strip */}
          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar min-w-0 flex-1 pr-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 shrink-0">
              Iterations:
            </span>

            {iterations.length === 0 ? (
              <span className="text-muted-foreground/70 italic text-[11px] px-1">
                No iterations defined
              </span>
            ) : (
              iterations.map((iter) => {
                const isActive = iter.id === activeIterationId;
                return (
                  <button
                    key={iter.id}
                    type="button"
                    onClick={() => onSelectIteration(iter.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-5 px-2 rounded text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0',
                      isActive
                        ? 'bg-primary/15 text-foreground font-semibold border border-primary/40 shadow-2xs'
                        : 'bg-card/50 hover:bg-accent/80 text-muted-foreground hover:text-foreground border border-border/60'
                    )}
                    title={iter.goal || iter.title}
                  >
                    <Target
                      size={11}
                      className={cn(isActive ? 'text-primary' : 'text-muted-foreground/70')}
                    />
                    <span>{iter.title}</span>

                    {/* Iteration Status Pill */}
                    {iter.status === 'review_ready' ? (
                      <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                        Review Ready {iter.changesCount ? `(±${iter.changesCount})` : ''}
                      </span>
                    ) : iter.status === 'agent_running' ? (
                      <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-400 font-bold border border-sky-500/30 flex items-center gap-0.5">
                        <Zap size={9} className="text-sky-400" />
                        Active ⚡
                      </span>
                    ) : iter.status === 'done' ? (
                      <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                        Done ✓
                      </span>
                    ) : (
                      <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-muted/80 text-muted-foreground border border-border/40">
                        Planned ○
                      </span>
                    )}
                  </button>
                );
              })
            )}

            {/* + New Iteration Button */}
            {onNewIteration && (
              <button
                type="button"
                onClick={onNewIteration}
                className="inline-flex items-center gap-1 h-5 px-2 rounded text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 border border-dashed border-border/80 hover:border-primary/30 transition-colors cursor-pointer shrink-0"
              >
                <Plus size={10} />
                <span>New Iteration</span>
              </button>
            )}
          </div>

          {/* Right: Stage Navigation Switcher */}
          <div className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => onSelectStage('diff')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors cursor-pointer',
                activeStage === 'diff'
                  ? 'bg-primary/15 text-primary font-bold border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
            >
              Diff Review
            </button>
            <button
              type="button"
              onClick={() => onSelectStage('plan')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors cursor-pointer',
                activeStage === 'plan'
                  ? 'bg-primary/15 text-primary font-bold border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
            >
              Process DAG
            </button>
            <button
              type="button"
              onClick={() => onSelectStage('knowledge')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors cursor-pointer',
                activeStage === 'knowledge'
                  ? 'bg-primary/15 text-primary font-bold border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
            >
              Knowledge
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
