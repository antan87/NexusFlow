import type { TerminalLaunch } from '../terminal/client.js';
import { useSyncExternalStore } from 'react';
import { FLOATING_CHAT_STORAGE_KEY, LEGACY_FLOATING_CHAT_STORAGE_KEY } from '../../brand';

export interface FloatingChatState {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  openTabs: string[];
  activeTab: string | null;
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
  modes: Record<string, 'cli' | 'chat'>;
  harnesses: Record<string, string>;
  terminalLaunches: Record<string, TerminalLaunch>;
  drafts: Record<string, { id: string; text: string }>;
}

const DEFAULT_STATE: FloatingChatState = {
  isOpen: false,
  isMinimized: false,
  isMaximized: false,
  openTabs: [],
  activeTab: null,
  position: null,
  size: { width: 560, height: 680 },
  drafts: {},
  modes: {},
  harnesses: {},
  terminalLaunches: {},
};

function loadState(): FloatingChatState {
  try {
    const raw = localStorage.getItem(FLOATING_CHAT_STORAGE_KEY) ?? localStorage.getItem(LEGACY_FLOATING_CHAT_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      drafts: {},
      harnesses: Object.fromEntries(Object.entries(parsed.harnesses ?? {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>,
      terminalLaunches: {},
      modes: Object.fromEntries(Object.entries(parsed.modes ?? {}).filter(([, mode]) => mode === 'cli' || mode === 'chat')) as Record<string, 'cli' | 'chat'>,
      isOpen: typeof parsed.isOpen === 'boolean' ? parsed.isOpen : DEFAULT_STATE.isOpen,
      isMinimized: typeof parsed.isMinimized === 'boolean' ? parsed.isMinimized : DEFAULT_STATE.isMinimized,
      isMaximized: typeof parsed.isMaximized === 'boolean' ? parsed.isMaximized : DEFAULT_STATE.isMaximized,
      openTabs: Array.isArray(parsed.openTabs) ? parsed.openTabs.filter((t: unknown) => typeof t === 'string') : [],
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : null,
      position: parsed.position && typeof parsed.position.x === 'number' && typeof parsed.position.y === 'number'
        ? { x: parsed.position.x, y: parsed.position.y }
        : null,
      size: parsed.size && typeof parsed.size.width === 'number' && typeof parsed.size.height === 'number'
        ? {
            width: Math.max(380, Math.min(parsed.size.width, window.innerWidth || 1200)),
            height: Math.max(420, Math.min(parsed.size.height, window.innerHeight || 900)),
          }
        : DEFAULT_STATE.size,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

let currentState: FloatingChatState = loadState();
const listeners = new Set<() => void>();

function notify() {
  try {
    localStorage.setItem(FLOATING_CHAT_STORAGE_KEY, JSON.stringify({ ...currentState, terminalLaunches: {}, drafts: {} }));
  } catch {
    // Non-fatal if localStorage is unavailable
  }
  for (const listener of listeners) {
    listener();
  }
}

function updateState(updater: (prev: FloatingChatState) => FloatingChatState) {
  currentState = updater(currentState);
  notify();
}

export const floatingChatStore = {
  getState: () => currentState,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  openTerminal: (branchName: string, target = 'shell', sessionId?: string, cwd?: string) => {
    floatingChatStore.open(branchName);
    floatingChatStore.setHarness(branchName, target);
    updateState(prev => ({ ...prev, modes: { ...prev.modes, [branchName]: 'cli' }, terminalLaunches: { ...prev.terminalLaunches, [branchName]: { id: crypto.randomUUID(), target, sessionId, cwd } } }));
  },
  consumeTerminalLaunch: (branchName: string, id: string) => {
    updateState(prev => {
      if (prev.terminalLaunches[branchName]?.id !== id) return prev;
      const terminalLaunches = { ...prev.terminalLaunches }; delete terminalLaunches[branchName];
      return { ...prev, terminalLaunches };
    });
  },
  setMode: (branchName: string, mode: 'cli' | 'chat') => updateState(prev => ({ ...prev, modes: { ...prev.modes, [branchName]: mode } })),
  setHarness: (branchName: string, harness: string) => updateState(prev => ({ ...prev, harnesses: { ...prev.harnesses, [branchName]: harness } })),
  openDraft: (branchName: string, text: string) => {
    floatingChatStore.open(branchName);
    floatingChatStore.setMode(branchName, 'chat');
    updateState((prev) => ({ ...prev, drafts: {
      ...prev.drafts,
      [branchName]: { id: crypto.randomUUID(), text },
    } }));
  },

  consumeDraft: (branchName: string, id: string) => {
    updateState((prev) => {
      if (prev.drafts[branchName]?.id !== id) return prev;
      const drafts = { ...prev.drafts };
      delete drafts[branchName];
      return { ...prev, drafts };
    });
  },

  open: (branchName?: string) => {
    updateState((prev) => {
      const openTabs = [...prev.openTabs];
      let activeTab = prev.activeTab;

      if (branchName) {
        if (!openTabs.includes(branchName)) {
          openTabs.push(branchName);
        }
        activeTab = branchName;
      } else if (!activeTab && openTabs.length > 0) {
        activeTab = openTabs[0];
      }

      return {
        ...prev,
        isOpen: true,
        isMinimized: false,
        openTabs,
        activeTab,
      };
    });
  },

  close: () => {
    updateState((prev) => ({
      ...prev,
      isOpen: false,
      isMinimized: false,
    }));
  },

  minimize: () => {
    updateState((prev) => ({
      ...prev,
      isMinimized: true,
    }));
  },

  restore: () => {
    updateState((prev) => ({
      ...prev,
      isOpen: true,
      isMinimized: false,
    }));
  },

  toggleMaximize: () => {
    updateState((prev) => ({
      ...prev,
      isMaximized: !prev.isMaximized,
      isMinimized: false,
    }));
  },

  addTab: (branchName: string) => {
    updateState((prev) => {
      const openTabs = prev.openTabs.includes(branchName)
        ? prev.openTabs
        : [...prev.openTabs, branchName];
      return {
        ...prev,
        isOpen: true,
        isMinimized: false,
        openTabs,
        activeTab: branchName,
      };
    });
  },

  removeTab: (branchName: string) => {
    updateState((prev) => {
      const openTabs = prev.openTabs.filter((t) => t !== branchName);
      let activeTab = prev.activeTab;
      if (activeTab === branchName) {
        activeTab = openTabs.length > 0 ? openTabs[openTabs.length - 1] : null;
      }
      return {
        ...prev,
        openTabs,
        activeTab,
        isOpen: openTabs.length > 0 ? prev.isOpen : false,
      };
    });
  },

  setActiveTab: (branchName: string) => {
    updateState((prev) => {
      if (!prev.openTabs.includes(branchName)) return prev;
      return {
        ...prev,
        activeTab: branchName,
        isMinimized: false,
      };
    });
  },

  setPosition: (position: { x: number; y: number } | null) => {
    updateState((prev) => ({
      ...prev,
      position,
    }));
  },

  setSize: (size: { width: number; height: number }) => {
    updateState((prev) => ({
      ...prev,
      size: {
        width: Math.max(380, Math.min(size.width, window.innerWidth || 1200)),
        height: Math.max(420, Math.min(size.height, window.innerHeight || 900)),
      },
    }));
  },
};

export function useFloatingChat(): FloatingChatState & typeof floatingChatStore {
  const state = useSyncExternalStore(
    floatingChatStore.subscribe,
    floatingChatStore.getState,
    () => DEFAULT_STATE,
  );

  return {
    ...state,
    ...floatingChatStore,
  };
}
