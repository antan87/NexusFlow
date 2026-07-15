import { API_BASE } from '../apiBase.js';

/** Error thrown for non-2xx API responses, carrying the HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Thin typed fetch wrapper for the NexusFlow API: prefixes API_BASE, sends
 * JSON, and normalizes `{ error }` bodies into thrown {@link ApiError}s.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}
