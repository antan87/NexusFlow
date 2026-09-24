import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatStorageKey,
  legacyChatStorageKey,
  saveChatStore,
  loadChatStore,
  type ChatStore,
  type ChatMessage,
} from './chatStore.js';
import type { NormalizedUsage, NormalizedRemainingQuota } from '../../types.js';

describe('chatStore Stress & Serialization Adversarial Tests', () => {
  let localStorageMock: Map<string, string>;

  beforeEach(() => {
    localStorageMock = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageMock.get(key) ?? null,
      setItem: (key: string, value: string) => localStorageMock.set(key, value),
      removeItem: (key: string) => localStorageMock.delete(key),
      clear: () => localStorageMock.clear(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Diverse Usage Shapes Serialization & Deserialization', () => {
    it('round-trips messages with minimal usage shapes (missing all optional fields)', () => {
      const minimalUsage: NormalizedUsage = {
        inputTokens: 150,
        outputTokens: 42,
      };

      const store: ChatStore = {
        v: 4,
        sessions: {},
        providerId: null,
        profilesByProvider: {},
        messages: [
          { role: 'user', content: 'Minimal test' },
          { role: 'assistant', content: 'Minimal response', usage: minimalUsage },
        ],
      };

      saveChatStore('minimal-branch', store);
      const loaded = loadChatStore('minimal-branch');

      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[1].usage).toEqual(minimalUsage);
      expect(loaded.messages[1].usage?.cachedInputTokens).toBeUndefined();
      expect(loaded.messages[1].usage?.costUsdEstimate).toBeUndefined();
      expect(loaded.messages[1].usage?.remainingQuota).toBeUndefined();
    });

    it('round-trips usage with 0 cached tokens explicitly and undefined cost estimate', () => {
      const zeroCacheUsage: NormalizedUsage = {
        inputTokens: 1000,
        outputTokens: 250,
        cachedInputTokens: 0,
        costUsdEstimate: undefined,
      };

      const store: ChatStore = {
        v: 4,
        sessions: {},
        providerId: null,
        profilesByProvider: {},
        messages: [
          { role: 'assistant', content: 'Zero cache turn', usage: zeroCacheUsage },
        ],
      };

      saveChatStore('zero-cache-branch', store);
      const loaded = loadChatStore('zero-cache-branch');

      expect(loaded.messages[0].usage?.cachedInputTokens).toBe(0);
      expect(loaded.messages[0].usage?.costUsdEstimate).toBeUndefined();
    });

    it('round-trips extreme token values and high-precision micro-costs without corruption', () => {
      const extremeUsage: NormalizedUsage = {
        inputTokens: Number.MAX_SAFE_INTEGER, // 9,007,199,254,740,991
        outputTokens: 50_000_000,
        cachedInputTokens: 100_000_000,
        cacheReadInputTokens: 75_000_000,
        cacheWriteInputTokens: 25_000_000,
        reasoningOutputTokens: 15_000_000,
        totalTokens: Number.MAX_SAFE_INTEGER,
        costUsdEstimate: 0.00000012345,
        costConfidence: 'authoritative',
      };

      const store: ChatStore = {
        v: 4,
        sessions: {},
        providerId: null,
        profilesByProvider: {},
        messages: [
          { role: 'assistant', content: 'Extreme metrics response', usage: extremeUsage },
        ],
      };

      saveChatStore('extreme-branch', store);
      const loaded = loadChatStore('extreme-branch');

      expect(loaded.messages[0].usage).toEqual(extremeUsage);
      expect(loaded.messages[0].usage?.inputTokens).toBe(Number.MAX_SAFE_INTEGER);
      expect(loaded.messages[0].usage?.costUsdEstimate).toBe(0.00000012345);
      expect(loaded.messages[0].usage?.costConfidence).toBe('authoritative');
    });

    it('round-trips complex embedded quota structures within usage.remainingQuota', () => {
      const fullQuota: NormalizedRemainingQuota = {
        tokens: {
          unit: 'tokens',
          remaining: 150_000,
          limit: 200_000,
          used: 50_000,
          resetsAt: '2026-09-24T18:00:00Z',
          resetInSeconds: 21600,
          status: 'ok',
        },
        requests: {
          unit: 'requests',
          remaining: 45,
          limit: 50,
          used: 5,
          status: 'ok',
        },
        contextWindow: {
          usedTokens: 120_000,
          maxTokens: 200_000,
          utilizationPercent: 60.0,
        },
        creditsRemainingUsd: 125.50,
        planType: 'plan-included',
        label: 'Tier 4 Enterprise',
        isEstimated: false,
        warningMessage: 'Window resets in 6 hours',
      };

      const complexUsage: NormalizedUsage = {
        inputTokens: 5000,
        outputTokens: 1200,
        cachedInputTokens: 3000,
        remainingQuota: fullQuota,
      };

      const store: ChatStore = {
        v: 4,
        sessions: { 'antigravity-cli': { id: 'agy-sess-1', started: true } },
        providerId: 'antigravity-cli',
        profilesByProvider: {},
        messages: [{ role: 'assistant', content: 'With quota', usage: complexUsage }],
      };

      saveChatStore('quota-branch', store);
      const loaded = loadChatStore('quota-branch');

      expect(loaded.messages[0].usage?.remainingQuota).toEqual(fullQuota);
      expect(loaded.messages[0].usage?.remainingQuota?.contextWindow?.utilizationPercent).toBe(60.0);
      expect(loaded.messages[0].usage?.remainingQuota?.planType).toBe('plan-included');
      expect(loaded.messages[0].usage?.remainingQuota?.tokens?.remaining).toBe(150_000);
    });

    it('preserves usage across large message histories (up to MAX_PERSISTED_MESSAGES)', () => {
      const messages: ChatMessage[] = [];
      for (let i = 1; i <= 600; i++) {
        messages.push({
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}`,
          ...(i % 2 === 0
            ? {
                usage: {
                  inputTokens: i * 10,
                  outputTokens: i * 2,
                  cachedInputTokens: i * 5,
                  costUsdEstimate: i * 0.0001,
                },
              }
            : {}),
        });
      }

      const store: ChatStore = {
        v: 4,
        sessions: {},
        providerId: null,
        profilesByProvider: {},
        messages,
      };

      saveChatStore('history-branch', store);
      const loaded = loadChatStore('history-branch');

      // Must be capped at MAX_PERSISTED_MESSAGES (500)
      expect(loaded.messages).toHaveLength(500);
      // The last message (message 600) should be preserved
      const lastMessage = loaded.messages[499];
      expect(lastMessage.content).toBe('Message 600');
      expect(lastMessage.usage).toEqual(messages[599].usage);
      expect(lastMessage.usage?.inputTokens).toBe(6000);
      expect(lastMessage.usage?.outputTokens).toBe(1200);
    });
  });

  describe('Storage Corruption Recovery and Fallbacks', () => {
    it('gracefully recovers from invalid or corrupt JSON in localStorage without throwing', () => {
      const corruptPayloads = [
        '{',
        '{"v": 4, "messages": [}',
        '<<<NOT JSON>>>',
        '\0\0\0\0',
        'undefined',
        'NaN',
        'null',
      ];

      for (const payload of corruptPayloads) {
        localStorageMock.set(chatStorageKey('corrupt-branch'), payload);
        let result: ChatStore | undefined;
        expect(() => {
          result = loadChatStore('corrupt-branch');
        }).not.toThrow();

        expect(result).toBeDefined();
        expect(result!.v).toBe(4);
        expect(result!.messages).toEqual([]);
        expect(result!.sessions).toEqual({});
      }
    });

    it('gracefully recovers from invalid non-object JSON values (numbers, booleans, primitives)', () => {
      const primitives = ['12345', '"plain-string"', 'true', 'false', '0'];

      for (const prim of primitives) {
        localStorageMock.set(chatStorageKey('prim-branch'), prim);
        let result: ChatStore | undefined;
        expect(() => {
          result = loadChatStore('prim-branch');
        }).not.toThrow();

        expect(result).toBeDefined();
        expect(result!.v).toBe(4);
        expect(result!.messages).toEqual([]);
      }
    });

    it('gracefully handles missing or null sessions/messages arrays in store object', () => {
      const malformedStructures = [
        JSON.stringify({ v: 4 }), // no sessions, no messages
        JSON.stringify({ v: 4, sessions: null, messages: null }),
        JSON.stringify({ v: 4, sessions: {}, messages: 'not-an-array' }),
        JSON.stringify({ v: 4, sessions: 123, messages: [] }),
        JSON.stringify({ v: 999, messages: [] }), // unsupported version
      ];

      for (const struct of malformedStructures) {
        localStorageMock.set(chatStorageKey('malformed-branch'), struct);
        let result: ChatStore | undefined;
        expect(() => {
          result = loadChatStore('malformed-branch');
        }).not.toThrow();

        expect(result!.v).toBe(4);
        expect(Array.isArray(result!.messages)).toBe(true);
      }
    });

    it('migrates legacy v1 bare message array format while preserving turn usage', () => {
      const legacyV1 = [
        { role: 'user', content: 'Hello from v1' },
        {
          role: 'assistant',
          content: 'Hi! Here is your v1 reply',
          usage: {
            inputTokens: 300,
            outputTokens: 75,
            cachedInputTokens: 50,
            costUsdEstimate: 0.002,
          },
        },
      ];

      localStorageMock.set(chatStorageKey('legacy-v1-branch'), JSON.stringify(legacyV1));
      const loaded = loadChatStore('legacy-v1-branch');

      expect(loaded.v).toBe(4);
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0]).toEqual({ role: 'user', content: 'Hello from v1' });
      expect(loaded.messages[1]).toEqual({
        role: 'assistant',
        content: 'Hi! Here is your v1 reply',
        usage: {
          inputTokens: 300,
          outputTokens: 75,
          cachedInputTokens: 50,
          costUsdEstimate: 0.002,
        },
      });
    });

    it('falls back to legacy storage key when primary storage key is absent', () => {
      const storeInLegacyKey: ChatStore = {
        v: 4,
        sessions: { 'codex-cli': { id: 'old-codex-sess', started: true } },
        providerId: 'codex-cli',
        profilesByProvider: {},
        messages: [
          {
            role: 'assistant',
            content: 'Legacy key test',
            usage: { inputTokens: 400, outputTokens: 80 },
          },
        ],
      };

      // Set ONLY legacy key
      localStorageMock.set(legacyChatStorageKey('fallback-branch'), JSON.stringify(storeInLegacyKey));
      const loaded = loadChatStore('fallback-branch');

      expect(loaded.v).toBe(4);
      expect(loaded.messages).toHaveLength(1);
      expect(loaded.messages[0].usage).toEqual({ inputTokens: 400, outputTokens: 80 });
      expect(loaded.sessions['codex-cli'].id).toBe('old-codex-sess');
    });

    it('handles persistent quota exhaustion during saveChatStore without throwing and attempts remote sync', () => {
      // Setup localStorage to throw QuotaExceededError even when images are stripped
      vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('Disk full or quota exceeded permanently', 'QuotaExceededError');
        },
        removeItem: () => {},
      });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const store: ChatStore = {
        v: 4,
        sessions: {},
        providerId: null,
        profilesByProvider: {},
        messages: [
          {
            role: 'assistant',
            content: 'Unsaveable turn',
            usage: { inputTokens: 50, outputTokens: 20 },
          },
        ],
      };

      // Must NOT throw
      expect(() => {
        saveChatStore('unwriteable-branch', store);
      }).not.toThrow();

      // Remote sync MUST still have been invoked
      expect(fetchMock).toHaveBeenCalledOnce();
      const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(payload.messages[0].usage).toEqual({ inputTokens: 50, outputTokens: 20 });
    });
  });
});
