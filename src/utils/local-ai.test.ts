import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLocalLlm, isOllamaModelAvailable, getOpenAiCompatibleUrl } from './local-ai.js';

describe('local-ai utilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isOllamaModelAvailable', () => {
    it('should match exact model names and tag variations', () => {
      const models = [{ name: 'qwen2.5-coder:1.5b' }, { name: 'llama3:latest' }];
      expect(isOllamaModelAvailable(models, 'qwen2.5-coder:1.5b')).toBe(true);
      expect(isOllamaModelAvailable(models, 'llama3')).toBe(true);
      expect(isOllamaModelAvailable(models, 'llama3:latest')).toBe(true);
      expect(isOllamaModelAvailable(models, 'non-existent')).toBe(false);
    });
  });

  describe('getOpenAiCompatibleUrl', () => {
    it('should properly format endpoint URLs', () => {
      expect(getOpenAiCompatibleUrl('http://localhost:11434', '/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
      expect(getOpenAiCompatibleUrl('http://localhost:11434/', '/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
      expect(getOpenAiCompatibleUrl('http://localhost:1234/v1', '/v1/chat/completions')).toBe('http://localhost:1234/v1/chat/completions');
      expect(getOpenAiCompatibleUrl('http://localhost:1234/v1/', '/v1/chat/completions')).toBe('http://localhost:1234/v1/chat/completions');
    });
  });

  describe('callLocalLlm', () => {
    const configOllama = {
      enabled: true,
      provider: 'ollama' as const,
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5-coder:1.5b',
    };

    const configOpenAi = {
      enabled: true,
      provider: 'openai-compatible' as const,
      endpoint: 'http://localhost:1234/v1',
      model: 'custom-model',
    };

    const messages = [{ role: 'user' as const, content: 'Hello' }];

    it('should request and return message content for Ollama provider', async () => {
      const mockResponse = {
        message: {
          content: 'Hello from Ollama!',
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const response = await callLocalLlm(configOllama, messages);

      expect(response).toBe('Hello from Ollama!');
      expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder:1.5b',
          messages,
          stream: false,
        }),
        signal: expect.any(AbortSignal),
      });
    });

    it('should throw an error if Ollama response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      } as any);

      await expect(callLocalLlm(configOllama, messages)).rejects.toThrow(
        'Ollama request failed with status 500: Internal server error'
      );
    });

    it('should request and return message content for OpenAI provider', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello from OpenAI!',
            },
          },
        ],
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as any);

      const response = await callLocalLlm(configOpenAi, messages);

      expect(response).toBe('Hello from OpenAI!');
      expect(fetch).toHaveBeenCalledWith('http://localhost:1234/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'custom-model',
          messages,
          stream: false,
        }),
        signal: expect.any(AbortSignal),
      });
    });

    it('should throw an error if OpenAI response has invalid format', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as any);

      await expect(callLocalLlm(configOpenAi, messages)).rejects.toThrow(
        'Invalid response format received from OpenAI-compatible endpoint'
      );
    });
  });
});
