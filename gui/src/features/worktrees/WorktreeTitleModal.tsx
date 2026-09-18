/**
 * WorktreeTitleModal Component: Modal dialog to edit semantic title and intent of a worktree.
 * File: gui/src/features/worktrees/WorktreeTitleModal.tsx
 */
import React, { useState, useEffect } from 'react';
import { X, Target, GitBranch, Save } from 'lucide-react';
import type { WorktreeDescriptor } from './types.js';

export interface WorktreeTitleModalProps {
  worktree: WorktreeDescriptor | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (worktreeId: string, title: string, intent?: string) => void;
}

export const WorktreeTitleModal: React.FC<WorktreeTitleModalProps> = ({
  worktree,
  isOpen,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState('');

  useEffect(() => {
    if (worktree) {
      setTitle(worktree.title || '');
      setIntent(worktree.intent || '');
    }
  }, [worktree]);

  if (!isOpen || !worktree) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(worktree.id, title.trim(), intent.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Target size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Edit Worktree Metadata</h2>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <GitBranch size={10} />
                <span>{worktree.branchName}</span>
                <span>•</span>
                <span>{worktree.repoName}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-foreground/90 mb-1">
              Human Title (Semantic Intent)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Vacation Agreement Calc Engine"
              required
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              High-contrast title displayed prominently across the left panel and cockpit header.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground/90 mb-1">
              Intent / Strategic Objective
            </label>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="Describe the architectural objective or feature requirements of this worktree slice..."
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <Save size={13} />
              <span>Save Metadata</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
