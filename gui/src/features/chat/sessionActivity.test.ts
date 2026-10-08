import { describe, expect, it, vi } from 'vitest';

import { activityNotes, createSessionActivityStore } from './sessionActivity.js';

describe('session activity store', () => {
  it('starts empty and records what the terminal reports', () => {
    const store = createSessionActivityStore();
    expect(store.getState()).toEqual({});
    store.setStatus('alpha', 'running');
    store.setStatus('beta', 'disconnected');
    expect(store.getState()).toEqual({
      alpha: { status: 'running', unread: false },
      beta: { status: 'disconnected', unread: false },
    });
  });

  it('marks output unread without losing the status, and clears it once the chat is looked at', () => {
    const store = createSessionActivityStore();
    store.setStatus('alpha', 'running');
    store.markUnread('alpha');
    expect(store.getState().alpha).toEqual({ status: 'running', unread: true });
    store.markSeen(['alpha']);
    expect(store.getState().alpha).toEqual({ status: 'running', unread: false });
  });

  it('marks only the chats named as seen, and ignores empty names and chats with nothing unread', () => {
    const store = createSessionActivityStore();
    store.markUnread('alpha');
    store.markUnread('beta');
    store.markSeen([null, 'gamma', 'alpha']);
    expect(store.getState().alpha?.unread).toBe(false);
    expect(store.getState().beta?.unread).toBe(true);
    expect(store.getState().gamma).toBeUndefined();
  });

  it('keeps unread output for a chat that is not on screen across further reports', () => {
    const store = createSessionActivityStore();
    store.markUnread('alpha');
    store.setStatus('alpha', 'running');
    store.markUnread('alpha');
    expect(store.getState().alpha).toEqual({ status: 'running', unread: true });
  });

  it('wakes subscribers when something changes and not when a report repeats what is known', () => {
    const store = createSessionActivityStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.setStatus('alpha', 'exited');
    expect(listener).toHaveBeenCalledTimes(1);
    const before = store.getState();
    store.setStatus('alpha', 'exited');
    store.markSeen(['alpha']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toBe(before);
    stop();
    store.markUnread('alpha');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets workspaces whose chat is closed, so a reopened one starts clean', () => {
    const store = createSessionActivityStore();
    const listener = vi.fn();
    store.setStatus('alpha', 'disconnected');
    store.markUnread('beta');
    store.subscribe(listener);
    store.prune(['alpha']);
    expect(store.getState()).toEqual({ alpha: { status: 'disconnected', unread: false } });
    expect(listener).toHaveBeenCalledTimes(1);
    // Nothing left to forget: no wake-up.
    store.prune(['alpha', 'gamma']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('activityNotes', () => {
  it('says nothing about a terminal that is running or idle, or about one we know nothing of', () => {
    expect(activityNotes(undefined)).toEqual([]);
    expect(activityNotes({ status: null, unread: false })).toEqual([]);
    expect(activityNotes({ status: 'running', unread: false })).toEqual([]);
    expect(activityNotes({ status: 'idle', unread: false })).toEqual([]);
  });

  it('names a terminal that stopped or lost its connection, and new output', () => {
    expect(activityNotes({ status: 'exited', unread: false })).toEqual(['Terminal exited']);
    expect(activityNotes({ status: 'disconnected', unread: false })).toEqual(['Terminal disconnected']);
    expect(activityNotes({ status: 'running', unread: true })).toEqual(['New terminal output']);
    expect(activityNotes({ status: 'disconnected', unread: true })).toEqual(['Terminal disconnected', 'New terminal output']);
  });
});
