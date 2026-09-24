import { afterEach, expect, it, vi } from 'vitest';
import { chatStorageKey, saveChatStore, loadChatStore, type ChatStore } from './chatStore.js';

afterEach(() => vi.unstubAllGlobals());

it('saves the remote image turn even when the browser storage quota is exhausted', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    setItem: (key: string, value: string) => {
      if (value.includes('data:image/png')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      saved.set(key, value);
    },
    removeItem: (key: string) => saved.delete(key),
  });
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  const store: ChatStore = { v: 4, sessions: {}, providerId: null, profilesByProvider: {}, messages: [{ role: 'user', content: 'Inspect this', images: ['data:image/png;base64,AAA='] }] };
  saveChatStore('images', store);
  expect(JSON.parse(saved.get(chatStorageKey('images'))!).messages[0]).not.toHaveProperty('images');
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).messages[0].images).toEqual(store.messages[0]!.images);
});

it('persists ChatMessage.usage across saveChatStore and loadChatStore', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

  const store: ChatStore = {
    v: 4,
    sessions: { 'claude-cli': { id: 'sess-123', started: true } },
    providerId: 'claude-cli',
    profilesByProvider: {},
    messages: [
      { role: 'user', content: 'Count to ten' },
      {
        role: 'assistant',
        content: '1 2 3 4 5 6 7 8 9 10',
        usage: {
          inputTokens: 1200,
          outputTokens: 350,
          cachedInputTokens: 400,
          costUsdEstimate: 0.0125,
        },
      },
    ],
  };

  saveChatStore('usage-branch', store);
  const loaded = loadChatStore('usage-branch');

  expect(loaded.messages).toHaveLength(2);
  expect(loaded.messages[1].usage).toEqual({
    inputTokens: 1200,
    outputTokens: 350,
    cachedInputTokens: 400,
    costUsdEstimate: 0.0125,
  });
});

it('preserves ChatMessage.usage in remote sync payload and when images are stripped on quota exhaustion', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    setItem: (key: string, value: string) => {
      if (value.includes('data:image/png')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      saved.set(key, value);
    },
    removeItem: (key: string) => saved.delete(key),
    getItem: (key: string) => saved.get(key) ?? null,
  });
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);

  const store: ChatStore = {
    v: 4,
    sessions: {},
    providerId: null,
    profilesByProvider: {},
    messages: [
      {
        role: 'assistant',
        content: 'Analyzed diagram',
        images: ['data:image/png;base64,AAA='],
        usage: {
          inputTokens: 2500,
          outputTokens: 600,
          cachedInputTokens: 1000,
          costUsdEstimate: 0.024,
        },
      },
    ],
  };

  saveChatStore('quota-branch', store);

  // Local storage stripped images but preserved usage
  const localSaved = JSON.parse(saved.get(chatStorageKey('quota-branch'))!);
  expect(localSaved.messages[0]).not.toHaveProperty('images');
  expect(localSaved.messages[0].usage).toEqual(store.messages[0].usage);

  // Remote fetch preserved both images and usage
  expect(fetch).toHaveBeenCalledOnce();
  const remoteBody = JSON.parse(fetch.mock.calls[0]![1].body);
  expect(remoteBody.messages[0].usage).toEqual(store.messages[0].usage);
  expect(remoteBody.messages[0].images).toEqual(store.messages[0].images);
});

