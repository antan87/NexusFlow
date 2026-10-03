import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLOATING_CHAT_STORAGE_KEY } from '../../brand';

type Store = typeof import('./floatingChatStore.js');

/** The store keeps its state in the module, so each test loads a fresh copy over a fake localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    api: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    },
  };
}

async function load(initial: Record<string, string> = {}) {
  const storage = fakeStorage(initial);
  vi.stubGlobal('localStorage', storage.api);
  vi.resetModules();
  const mod: Store = await import('./floatingChatStore.js');
  return { ...mod, storage };
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('opening a chat', () => {
  it('adds the tab, makes it active, and asks to see it', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha', 'cli');
    expect(store.getState()).toMatchObject({ openTabs: ['alpha'], activeTab: 'alpha', modes: { alpha: 'cli' }, focusRequest: 1 });
  });

  it('does not duplicate a tab that is open, and asks again each time', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha');
    store.open('beta');
    store.open('alpha');
    expect(store.getState().openTabs).toEqual(['alpha', 'beta']);
    expect(store.getState().activeTab).toBe('alpha');
    expect(store.getState().focusRequest).toBe(3);
  });

  it('keeps the active tab when asked to open with no workspace, and falls back to the first tab', async () => {
    const { floatingChatStore: store } = await load();
    store.open();
    expect(store.getState().activeTab).toBeNull();
    store.open('alpha');
    store.open('beta');
    store.open();
    expect(store.getState().activeTab).toBe('beta');
  });

  it('opens a terminal with its launch, mode and harness, and does not queue the same session twice', async () => {
    const { floatingChatStore: store } = await load();
    store.openTerminal('alpha', 'claude', 'session-1', '/work');
    const launch = store.getState().terminalLaunches.alpha;
    expect(launch).toMatchObject({ target: 'claude', sessionId: 'session-1', cwd: '/work' });
    expect(store.getState()).toMatchObject({ modes: { alpha: 'cli' }, harnesses: { alpha: 'claude' }, activeTab: 'alpha' });
    const before = store.getState().focusRequest;
    store.openTerminal('alpha', 'claude', 'session-1', '/work');
    expect(store.getState().terminalLaunches.alpha).toBe(launch);
    expect(store.getState().focusRequest).toBeGreaterThan(before);
  });
});

describe('revealing a chat because the address says so', () => {
  it('adds the tab and makes it active without asking to see it', async () => {
    const { floatingChatStore: store } = await load();
    store.reveal('alpha');
    expect(store.getState()).toMatchObject({ openTabs: ['alpha'], activeTab: 'alpha', focusRequest: 0 });
    store.reveal('beta');
    expect(store.getState()).toMatchObject({ openTabs: ['alpha', 'beta'], activeTab: 'beta', focusRequest: 0 });
  });

  it('leaves everything alone, and wakes nobody, when that chat is already the active one', async () => {
    const { floatingChatStore: store } = await load();
    store.reveal('alpha');
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.reveal('alpha');
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('swaps places with the docked second workspace instead of showing it twice', async () => {
    const { floatingChatStore: store } = await load();
    store.reveal('alpha');
    store.setSplitTab('beta');
    store.reveal('beta');
    expect(store.getState()).toMatchObject({ activeTab: 'beta', splitTab: 'alpha' });
  });
});

describe('switching and closing tabs', () => {
  it('asks to see a chat when its tab is chosen, and ignores a tab that is not open', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha'); store.open('beta');
    const before = store.getState().focusRequest;
    store.setActiveTab('alpha');
    expect(store.getState()).toMatchObject({ activeTab: 'alpha', focusRequest: before + 1 });
    const unchanged = store.getState();
    store.setActiveTab('ghost');
    expect(store.getState()).toBe(unchanged);
  });

  it('closing a tab that is not on screen leaves the screen alone', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha'); store.open('beta');
    const before = store.getState().focusRequest;
    store.removeTab('alpha');
    expect(store.getState()).toMatchObject({ openTabs: ['beta'], activeTab: 'beta', focusRequest: before });
  });

  it('closing the tab on screen brings the next one up and asks to see it', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha'); store.open('beta'); store.open('gamma');
    const before = store.getState().focusRequest;
    store.removeTab('gamma');
    expect(store.getState()).toMatchObject({ openTabs: ['alpha', 'beta'], activeTab: 'alpha', focusRequest: before + 1 });
  });

  it('closing the last tab leaves no chat to show and asks for nothing', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha');
    const before = store.getState().focusRequest;
    store.removeTab('alpha');
    expect(store.getState()).toMatchObject({ openTabs: [], activeTab: null, focusRequest: before });
  });

  it('ignores closing a tab that is not open', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha');
    const before = store.getState();
    store.removeTab('ghost');
    expect(store.getState()).toBe(before);
  });

  it('closing the docked second workspace clears the split, and closing the active one never leaves it beside itself', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha'); store.open('beta');
    store.setSplitTab('alpha');
    expect(store.getState().splitTab).toBe('alpha');
    store.removeTab('alpha');
    expect(store.getState().splitTab).toBeNull();
    store.open('gamma');
    store.setSplitTab('beta');
    store.removeTab('gamma');
    expect(store.getState().activeTab).not.toBe(store.getState().splitTab);
  });

  it('refuses to dock a workspace beside itself and opens a tab for one that has none', async () => {
    const { floatingChatStore: store } = await load();
    store.open('alpha');
    const before = store.getState();
    store.setSplitTab('alpha');
    expect(store.getState()).toBe(before);
    store.setSplitTab('beta');
    expect(store.getState()).toMatchObject({ openTabs: ['alpha', 'beta'], splitTab: 'beta' });
  });

  it('keeps the split ratio within its limits', async () => {
    const { floatingChatStore: store, CHAT_GEOMETRY } = await load();
    store.setSplitRatio(1);
    expect(store.getState().splitRatio).toBe(CHAT_GEOMETRY.splitMinRatio);
    store.setSplitRatio(99);
    expect(store.getState().splitRatio).toBe(CHAT_GEOMETRY.splitMaxRatio);
  });
});

describe('changes that change nothing', () => {
  it('do not save or notify', async () => {
    const { floatingChatStore: store, storage } = await load();
    store.setMode('alpha', 'cli');
    store.setHarness('alpha', 'claude');
    const saved = storage.data.get(FLOATING_CHAT_STORAGE_KEY);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setMode('alpha', 'cli');
    store.setHarness('alpha', 'claude');
    store.consumeTerminalLaunch('alpha', 'nothing-queued');
    store.consumeDraft('alpha', 'nothing-queued');
    expect(listener).not.toHaveBeenCalled();
    expect(storage.data.get(FLOATING_CHAT_STORAGE_KEY)).toBe(saved);
  });

  it('a draft or launch is consumed once, and only by its own id', async () => {
    const { floatingChatStore: store } = await load();
    store.openDraft('alpha', 'hello');
    const draft = store.getState().drafts.alpha!;
    expect(draft.text).toBe('hello');
    expect(store.getState().modes.alpha).toBe('chat');
    store.consumeDraft('alpha', 'someone-else');
    expect(store.getState().drafts.alpha).toBe(draft);
    store.consumeDraft('alpha', draft.id);
    expect(store.getState().drafts.alpha).toBeUndefined();
  });
});

describe('saved state', () => {
  it('saves the tabs but never the request to look, the launches or the drafts', async () => {
    const { floatingChatStore: store, storage } = await load();
    store.openTerminal('alpha', 'claude', 's1');
    store.openDraft('beta', 'text');
    const saved = JSON.parse(storage.data.get(FLOATING_CHAT_STORAGE_KEY)!);
    expect(saved.openTabs).toEqual(['alpha', 'beta']);
    expect(saved.focusRequest).toBe(0);
    expect(saved.terminalLaunches).toEqual({});
    expect(saved.drafts).toEqual({});
  });

  it('comes back with its tabs after a reload, without asking to look', async () => {
    const first = await load();
    first.floatingChatStore.open('alpha'); first.floatingChatStore.open('beta');
    const second = await load({ [FLOATING_CHAT_STORAGE_KEY]: first.storage.data.get(FLOATING_CHAT_STORAGE_KEY)! });
    expect(second.floatingChatStore.getState()).toMatchObject({ openTabs: ['alpha', 'beta'], activeTab: 'beta', focusRequest: 0 });
  });

  it('ignores what the floating window saved, and cleans up what it reads', async () => {
    const legacy = JSON.stringify({
      isOpen: true, isMinimized: true, isMaximized: true, position: { x: 5, y: 9 }, size: { width: 700, height: 600 },
      openTabs: ['alpha', 7, 'alpha', 'beta', null], activeTab: 'beta', splitTab: 'beta', splitRatio: 'wide',
      modes: { alpha: 'cli', beta: 'sideways' }, harnesses: { alpha: 'claude', beta: 3 },
    });
    const { floatingChatStore: store } = await load({ [FLOATING_CHAT_STORAGE_KEY]: legacy });
    const state = store.getState();
    expect(state.openTabs).toEqual(['alpha', 'beta']);
    expect(state.activeTab).toBe('beta');
    expect(state.splitTab).toBeNull();
    expect(state.splitRatio).toBe(50);
    expect(state.modes).toEqual({ alpha: 'cli' });
    expect(state.harnesses).toEqual({ alpha: 'claude' });
    expect(Object.keys(state).sort()).toEqual(['activeTab', 'drafts', 'focusRequest', 'harnesses', 'modes', 'openTabs', 'splitRatio', 'splitTab', 'terminalLaunches']);
  });

  it('starts empty when the saved state is unreadable, or storage is unavailable', async () => {
    const broken = await load({ [FLOATING_CHAT_STORAGE_KEY]: '{not json' });
    expect(broken.floatingChatStore.getState().openTabs).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.resetModules();
    const { floatingChatStore: store } = await import('./floatingChatStore.js');
    expect(store.getState().openTabs).toEqual([]);
    expect(() => store.open('alpha')).not.toThrow();
    expect(store.getState().openTabs).toEqual(['alpha']);
  });
});
