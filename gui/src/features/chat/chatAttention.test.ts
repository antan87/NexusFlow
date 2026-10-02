import { describe, expect, it, vi } from 'vitest';
import { CHAT_ATTENTION_STORAGE_KEY } from '../../brand';
import type { InputRequest } from '../../types.js';
import { MAX_REMEMBERED_WORKSPACES, createAttentionStore, pendingRequests } from './chatAttention.js';

const request = (workspaceId: string, id: string, minutesAgo = 1): InputRequest => ({
  workspaceId,
  id,
  timestamp: new Date(Date.parse('2026-10-02T12:00:00.000Z') - minutesAgo * 60_000).toISOString(),
  harness: 'claude',
  message: `Question from ${workspaceId}`,
});

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(CHAT_ATTENTION_STORAGE_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('pendingRequests', () => {
  it('returns requests for open chats that have not been seen', () => {
    const result = pendingRequests([request('a', '1'), request('b', '2')], {}, ['a', 'b']);
    expect(result.map((r) => r.workspaceId)).toEqual(['a', 'b']);
  });

  it('drops a request once its id is recorded as seen', () => {
    const result = pendingRequests([request('a', '1'), request('b', '2')], { a: '1' }, ['a', 'b']);
    expect(result.map((r) => r.workspaceId)).toEqual(['b']);
  });

  it('raises the alert again when the same chat asks something new', () => {
    const result = pendingRequests([request('a', '2')], { a: '1' }, ['a']);
    expect(result.map((r) => r.id)).toEqual(['2']);
  });

  it('ignores requests for chats that are not open', () => {
    expect(pendingRequests([request('a', '1')], {}, ['b'])).toEqual([]);
    expect(pendingRequests([request('a', '1')], {}, [])).toEqual([]);
  });

  it('lists the longest-waiting chat first', () => {
    const result = pendingRequests(
      [request('recent', '1', 1), request('oldest', '2', 30), request('middle', '3', 10)],
      {},
      ['recent', 'oldest', 'middle'],
    );
    expect(result.map((r) => r.workspaceId)).toEqual(['oldest', 'middle', 'recent']);
  });

  it('copes with an unparseable timestamp and with no requests', () => {
    const odd = { ...request('a', '1'), timestamp: 'not a date' };
    expect(pendingRequests([odd, request('b', '2')], {}, ['a', 'b'])).toHaveLength(2);
    expect(pendingRequests([], {}, ['a'])).toEqual([]);
  });

  it('does not change its inputs', () => {
    const requests = [request('b', '2', 5), request('a', '1', 20)];
    const copy = structuredClone(requests);
    pendingRequests(requests, { a: 'x' }, ['a', 'b']);
    expect(requests).toEqual(copy);
  });
});

describe('createAttentionStore', () => {
  it('starts empty without storage', () => {
    expect(createAttentionStore(undefined).getSeen()).toEqual({});
  });

  it('records a seen request, persists it, and notifies subscribers once', () => {
    const storage = memoryStorage();
    const store = createAttentionStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.markSeen('a', '1');

    expect(store.getSeen()).toEqual({ a: '1' });
    expect(JSON.parse(storage.data.get(CHAT_ATTENTION_STORAGE_KEY)!)).toEqual({ a: '1' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the request is already recorded', () => {
    const storage = memoryStorage();
    const store = createAttentionStore(storage);
    store.markSeen('a', '1');
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSeen();

    store.markSeen('a', '1');

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSeen()).toBe(before);
  });

  it('replaces the id when the same chat is seen at a newer request', () => {
    const store = createAttentionStore(memoryStorage());
    store.markSeen('a', '1');
    store.markSeen('a', '2');
    expect(store.getSeen()).toEqual({ a: '2' });
  });

  it('stops notifying after unsubscribe', () => {
    const store = createAttentionStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.markSeen('a', '1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('restores what an earlier session saved', () => {
    const store = createAttentionStore(memoryStorage(JSON.stringify({ a: '1', b: '2' })));
    expect(store.getSeen()).toEqual({ a: '1', b: '2' });
  });

  it.each([
    ['not JSON', '{oops'],
    ['an array', '["a"]'],
    ['null', 'null'],
    ['a string', '"a"'],
  ])('starts empty when the saved value is %s', (_label, saved) => {
    expect(createAttentionStore(memoryStorage(saved)).getSeen()).toEqual({});
  });

  it('keeps only well-formed saved entries', () => {
    const store = createAttentionStore(memoryStorage(JSON.stringify({ a: '1', b: 2, c: '', d: null, e: '5' })));
    expect(store.getSeen()).toEqual({ a: '1', e: '5' });
  });

  it('keeps working in memory when storage throws on read or write', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    };
    const store = createAttentionStore(broken);
    expect(store.getSeen()).toEqual({});
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.markSeen('a', '1')).not.toThrow();

    expect(store.getSeen()).toEqual({ a: '1' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets the longest-unseen workspaces past the limit and keeps the newest', () => {
    const store = createAttentionStore(memoryStorage());
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES + 5; i++) store.markSeen(`ws-${i}`, `id-${i}`);

    const seen = store.getSeen();
    expect(Object.keys(seen)).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(seen['ws-0']).toBeUndefined();
    expect(seen['ws-4']).toBeUndefined();
    expect(seen[`ws-${MAX_REMEMBERED_WORKSPACES + 4}`]).toBe(`id-${MAX_REMEMBERED_WORKSPACES + 4}`);
  });

  it('counts a workspace seen again as recent, so it survives the pruning', () => {
    const store = createAttentionStore(memoryStorage());
    store.markSeen('keep-me', 'old');
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES - 1; i++) store.markSeen(`ws-${i}`, `id-${i}`);
    store.markSeen('keep-me', 'new');
    store.markSeen('one-more', 'x');

    expect(store.getSeen()['keep-me']).toBe('new');
    expect(store.getSeen()['ws-0']).toBeUndefined();
  });

  it('picks up a change made by another window on reload', () => {
    const storage = memoryStorage();
    const store = createAttentionStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    storage.data.set(CHAT_ATTENTION_STORAGE_KEY, JSON.stringify({ a: '9' }));
    store.reload();

    expect(store.getSeen()).toEqual({ a: '9' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
