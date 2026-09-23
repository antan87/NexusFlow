import { afterEach, expect, it, vi } from 'vitest';
import { chatStorageKey, saveChatStore, type ChatStore } from './chatStore.js';

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
