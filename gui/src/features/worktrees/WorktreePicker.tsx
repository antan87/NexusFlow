/**
 * WorktreePicker Component: Multi-repository accordion panel managing branch-keyed worktrees
 * with Bifocal metadata, status indicators, and worktree isolation triggers.
 * File: gui/src/features/worktrees/WorktreePicker.tsx
 */
import React, { useState, useMemo } from 'react';
import {
  FolderGit2,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Layers,
} from 'lucide-react';
import type { RepoWorktreeGroup, WorktreeDescriptor } from './types.js';
import { WorktreeItem } from './WorktreeItem.js';
import { WorktreeTitleModal } from './WorktreeTitleModal.js';

export interface WorktreePickerProps {
  repoGroups: RepoWorktreeGroup[];
  activeWorktreeId: string | null;
  onSelectWorktree: (wt: WorktreeDescriptor) => void;
  onNewWorktree?: (repoName: string) => void;
  onUpdateWorktreeTitle?: (worktreeId: string, title: string, intent?: string) => void;
  customTitles?: Record<string, { title: string; intent?: string }>;
}

export const WorktreePicker: React.FC<WorktreePickerProps> = ({
  repoGroups,
  activeWorktreeId,
  onSelectWorktree,
  onNewWorktree,
  onUpdateWorktreeTitle,
  customTitles = {},
}) => {
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});
  const [filterQuery, setFilterQuery] = useState('');
  const [editingWorktree, setEditingWorktree] = useState<WorktreeDescriptor | null>(null);

  const toggleRepo = (repoName: string) => {
    setExpandedRepos((prev) => ({
      ...prev,
      [repoName]: !(prev[repoName] ?? true), // default to expanded
    }));
  };

  // Enhance worktrees with any local custom titles
  const enrichedGroups = useMemo(() => {
    return repoGroups.map((group) => ({
      ...group,
      worktrees: group.worktrees.map((wt) => {
        const custom = customTitles[wt.id];
        if (custom) {
          return {
            ...wt,
            title: custom.title || wt.title,
            intent: custom.intent !== undefined ? custom.intent : wt.intent,
          };
        }
        return wt;
      }),
    }));
  }, [repoGroups, customTitles]);

  // Filter worktrees based on query
  const filteredGroups = useMemo(() => {
    if (!filterQuery.trim()) return enrichedGroups;
    const q = filterQuery.toLowerCase();
    return enrichedGroups.map((group) => ({
      ...group,
      worktrees: group.worktrees.filter(
        (wt) =>
          wt.title.toLowerCase().includes(q) ||
          wt.branchName.toLowerCase().includes(q) ||
          wt.repoName.toLowerCase().includes(q) ||
          (wt.intent && wt.intent.toLowerCase().includes(q))
      ),
    }));
  }, [enrichedGroups, filterQuery]);

  const totalWorktrees = useMemo(() => {
    return enrichedGroups.reduce((acc, g) => acc + g.worktrees.length, 0);
  }, [enrichedGroups]);

  return (
    <div className="flex flex-col gap-2 min-w-0 w-full">
      {/* Header & Quick Filter */}
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <Layers size={13} className="text-primary" />
          <span>Worktrees</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted font-mono">
            {totalWorktrees}
          </span>
        </div>
      </div>

      {/* Filter Input */}
      <div className="relative w-full">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
        />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter worktrees..."
          className="w-full rounded-md border border-border/60 bg-muted/30 pl-8 pr-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors"
        />
      </div>

      {/* Repositories & Worktrees Accordion */}
      <div className="flex flex-col gap-2 mt-1 min-w-0">
        {filteredGroups.map((group) => {
          const isExpanded = expandedRepos[group.repoName] ?? true;

          return (
            <div
              key={group.repoName}
              className="flex flex-col rounded-lg border border-border/40 bg-card/20 overflow-hidden"
            >
              {/* Repository Header */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleRepo(group.repoName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleRepo(group.repoName);
                  }
                }}
                className="flex items-center justify-between px-2.5 py-1.5 bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer select-none text-xs"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {isExpanded ? (
                    <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                  )}
                  <FolderGit2 size={13} className="text-muted-foreground shrink-0" />
                  <span className="font-semibold text-foreground truncate">{group.repoName}</span>

                  {group.isHostRepo && (
                    <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground/80 border border-border/40 uppercase">
                      ro
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {group.worktrees.length} wt
                  </span>

                  {onNewWorktree && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewWorktree(group.repoName);
                      }}
                      title={`Isolate new worktree in ${group.repoName}`}
                      className="p-0.5 hover:text-foreground text-muted-foreground hover:bg-accent rounded transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Worktree Items List */}
              {isExpanded && (
                <div className="p-1.5 flex flex-col gap-1">
                  {group.worktrees.length === 0 ? (
                    <div className="px-2 py-2 text-[11px] italic text-muted-foreground text-center">
                      No worktrees match filter
                    </div>
                  ) : (
                    group.worktrees.map((wt) => (
                      <WorktreeItem
                        key={wt.id}
                        worktree={wt}
                        isActive={wt.id === activeWorktreeId}
                        onSelect={onSelectWorktree}
                        onEditTitle={(item) => setEditingWorktree(item)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal for editing title & intent */}
      <WorktreeTitleModal
        worktree={editingWorktree}
        isOpen={Boolean(editingWorktree)}
        onClose={() => setEditingWorktree(null)}
        onSave={(wtId, title, intent) => {
          onUpdateWorktreeTitle?.(wtId, title, intent);
        }}
      />
    </div>
  );
};
