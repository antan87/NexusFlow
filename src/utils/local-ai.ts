/**
 * @module utils/local-ai
 * Handles requests to local LLM servers (Ollama or OpenAI-compatible like LM Studio).
 */

import type { LocalLlmConfig } from '../types.js';

export interface LocalLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sends a chat completion request to the configured local LLM provider.
 * Supports Ollama-specific API and standard OpenAI-compatible endpoints.
 */
export async function callLocalLlm(
  config: LocalLlmConfig,
  messages: LocalLlmMessage[],
): Promise<string> {
  const { provider, endpoint, model } = config;
  const cleanEndpoint = endpoint.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    if (provider === 'ollama') {
      const url = `${cleanEndpoint}/api/chat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama request failed with status ${response.status}: ${text}`);
      }

      const data: any = await response.json();
      if (data?.message?.content) {
        return data.message.content;
      }
      throw new Error('Invalid response format received from Ollama');
    } else {
      // OpenAI-compatible provider
      const url = getOpenAiCompatibleUrl(cleanEndpoint, '/v1/chat/completions');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI-compatible request failed with status ${response.status}: ${text}`);
      }

      const data: any = await response.json();
      if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }
      throw new Error('Invalid response format received from OpenAI-compatible endpoint');
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Local LLM request timed out after 60 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Checks whether a target model name matches any model in an Ollama model list.
 * Handles tag variations like 'model' vs 'model:latest' vs 'model:7b'.
 */
export function isOllamaModelAvailable(models: { name: string }[], targetModel: string): boolean {
  const normalize = (name: string) => name.includes(':') ? name : `${name}:latest`;
  const targetNorm = normalize(targetModel);
  return models.some((m) => normalize(m.name) === targetNorm);
}

/**
 * Helper to build standard OpenAI compatible URLs.
 * Handles cases where the configured endpoint already has or does not have `/v1`.
 */
export function getOpenAiCompatibleUrl(endpoint: string, suffix: string): string {
  const cleanEndpoint = endpoint.replace(/\/$/, '');
  const hasV1 = /\/v1\/?$/.test(cleanEndpoint);
  if (hasV1) {
    return `${cleanEndpoint.replace(/\/v1\/?$/, '')}${suffix}`;
  }
  return `${cleanEndpoint}${suffix}`;
}
