/**
 * State store for active worktree navigation, rail collapse ergonomics, and metadata overrides.
 * File: gui/src/features/worktrees/worktreeStore.ts
 */
import { useState, useCallback, useEffect } from 'react';
import type { WorktreeDescriptor } from './types.js';

const STORAGE_KEY_COLLAPSED = 'ctxspace_sidebar_collapsed';
const STORAGE_KEY_TITLES = 'ctxspace_worktree_titles';

export interface WorktreeTitleOverride {
  title: string;
  intent?: string;
}

export function loadSavedTitles(): Record<string, WorktreeTitleOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TITLES);
    return raw ? (JSON.parse(raw) as Record<string, WorktreeTitleOverride>) : {};
  } catch {
    return {};
  }
}

export function saveWorktreeTitle(worktreeId: string, title: string, intent?: string): void {
  try {
    const current = loadSavedTitles();
    current[worktreeId] = { title, intent };
    localStorage.setItem(STORAGE_KEY_TITLES, JSON.stringify(current));
  } catch (err) {
    void err;
  }
}

export function useWorktreeNavigationState() {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
    } catch {
      return false;
    }
  });

  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState('');
  const [editingWorktree, setEditingWorktree] = useState<WorktreeDescriptor | null>(null);
  const [customTitles, setCustomTitles] = useState<Record<string, WorktreeTitleOverride>>(() => loadSavedTitles());

  // Listen for storage updates across tabs/windows
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_TITLES && e.newValue) {
        try {
          setCustomTitles(JSON.parse(e.newValue) as Record<string, WorktreeTitleOverride>);
        } catch (err) {
          void err;
        }
      } else if (e.key === STORAGE_KEY_COLLAPSED) {
        setIsCollapsed(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next));
      } catch (err) {
        void err;
      }
      return next;
    });
  }, []);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed));
    } catch (err) {
      void err;
    }
  }, []);

  const toggleRepo = useCallback((repoName: string) => {
    setExpandedRepos((prev) => ({
      ...prev,
      [repoName]: !(prev[repoName] ?? true),
    }));
  }, []);

  const updateTitle = useCallback((worktreeId: string, title: string, intent?: string) => {
    saveWorktreeTitle(worktreeId, title, intent);
    setCustomTitles((prev) => ({
      ...prev,
      [worktreeId]: { title, intent },
    }));
  }, []);

  return {
    isCollapsed,
    setIsCollapsed: setCollapsed,
    toggleCollapsed,
    expandedRepos,
    toggleRepo,
    searchFilter,
    setSearchFilter,
    editingWorktree,
    setEditingWorktree,
    customTitles,
    updateTitle,
  };
}
