/**
 * WorktreeItem Component: Renders a single branch-keyed worktree row with Bifocal typography
 * and live git status indicators.
 * File: gui/src/features/worktrees/WorktreeItem.tsx
 */
import React from 'react';
import {
  GitBranch,
  Lock,
  Pencil,
  Zap,
  Check,
  Circle,
  FileCode2,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { WorktreeDescriptor } from './types.js';

export interface WorktreeItemProps {
  worktree: WorktreeDescriptor;
  isActive: boolean;
  onSelect: (wt: WorktreeDescriptor) => void;
  onEditTitle?: (wt: WorktreeDescriptor) => void;
}

export const WorktreeItem: React.FC<WorktreeItemProps> = ({
  worktree,
  isActive,
  onSelect,
  onEditTitle,
}) => {
  const shortSha = worktree.commitInfo?.shortSha || worktree.commitSha?.slice(0, 7) || 'head';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(worktree)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(worktree);
        }
      }}
      className={cn(
        'group relative flex flex-col gap-1 px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer select-none border',
        isActive
          ? 'bg-primary/10 border-primary/40 shadow-xs'
          : 'bg-card/40 hover:bg-accent/60 border-border/40 hover:border-border/80 text-muted-foreground hover:text-foreground'
      )}
    >
      {/* Tier 1: Prominent Human Title & Status Badges */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <FileCode2
            size={13}
            className={cn(
              'shrink-0',
              isActive ? 'text-primary' : 'text-muted-foreground/70'
            )}
          />
          <span
            className={cn(
              'text-xs font-medium tracking-tight truncate',
              isActive ? 'text-foreground font-semibold' : 'text-foreground/90'
            )}
            title={worktree.intent || worktree.title}
          >
            {worktree.title}
          </span>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-1 shrink-0">
          {worktree.status === 'active_review' || isActive ? (
            <span
              className="inline-flex items-center gap-1 font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              title="Active worktree in code review"
            >
              <Circle size={5} className="fill-current text-emerald-500" />
              <span>in review</span>
            </span>
          ) : worktree.status === 'agent_running' ? (
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse"
              title="Autonomous agent executing in this worktree"
            >
              <Zap size={9} className="text-amber-500" />
              <span>agent</span>
            </span>
          ) : worktree.status === 'host_readonly' ? (
            <span
              className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50 uppercase tracking-wider"
              title="Host repository reference (Read-Only)"
            >
              host: ro
            </span>
          ) : worktree.dirtyFilesCount > 0 ? (
            <span
              className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
              title={`${worktree.dirtyFilesCount} modified uncommitted files`}
            >
              ±{worktree.dirtyFilesCount}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[9px] font-medium px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/80 border border-border/40"
              title="Git worktree clean"
            >
              <Check size={9} className="text-emerald-500/80" />
              <span>clean</span>
            </span>
          )}

          {/* Pencil action to edit title */}
          {onEditTitle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditTitle(worktree);
              }}
              title="Edit human title and intent"
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-foreground text-muted-foreground/60 transition-opacity rounded"
            >
              <Pencil size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Tier 2: Technical Git Telemetry */}
      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/75 min-w-0 pl-4.5">
        {/* Branch Name */}
        <span className="flex items-center gap-1 min-w-0 truncate">
          <GitBranch size={10} className="shrink-0 text-muted-foreground/60" />
          <span className="truncate">{worktree.branchName}</span>
        </span>

        {/* Short SHA */}
        <span className="shrink-0 text-muted-foreground/50">@{shortSha}</span>

        {/* Pin Lock */}
        {worktree.isPinned && (
          <span
            className="shrink-0 flex items-center gap-0.5 text-primary/80"
            title="Worktree locked against pruning"
          >
            <Lock size={9} />
          </span>
        )}
      </div>
    </div>
  );
};
