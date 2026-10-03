/**
 * The change list out of a `/changes` reply. A reply that failed, or that has no
 * list, is an error: reading it as "no changes" would empty the view and make
 * every open diff look committed.
 */
export function changesFromResponse<T = unknown>(response: { ok: boolean; statusText?: string }, data: unknown): T[] {
  const body = (typeof data === 'object' && data !== null ? data : {}) as { changes?: unknown; error?: unknown };
  if (!response.ok || !Array.isArray(body.changes)) {
    const detail = typeof body.error === 'string' && body.error ? body.error : response.statusText || 'unexpected response';
    throw new Error(`Failed to load changes: ${detail}`);
  }
  return body.changes as T[];
}
