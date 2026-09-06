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
}

const DEFAULT_STATE: FloatingChatState = {
  isOpen: false,
  isMinimized: false,
  isMaximized: false,
  openTabs: [],
  activeTab: null,
  position: null,
  size: { width: 560, height: 680 },
};

function loadState(): FloatingChatState {
  try {
    const raw = localStorage.getItem(FLOATING_CHAT_STORAGE_KEY) ?? localStorage.getItem(LEGACY_FLOATING_CHAT_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
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
    localStorage.setItem(FLOATING_CHAT_STORAGE_KEY, JSON.stringify(currentState));
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
