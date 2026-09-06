import { API_BASE } from '../apiBase.js';
import { WORKROOM_BOOTSTRAP_HEADER, LEGACY_WORKROOM_BOOTSTRAP_HEADER } from '../../brand.js';

let workroomBootstrap: Promise<string> | undefined;
let workroomBootstrapToken: string | undefined;

function isWorkroomRequest(path: string): boolean {
  return path.startsWith('/api/workrooms/');
}

async function getWorkroomBootstrap(): Promise<string> {
  if (!workroomBootstrap) {
    const request = fetch(`${API_BASE}/api/workrooms/bootstrap`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data.token !== 'string') {
        throw new ApiError(
          data && typeof data.error === 'string' ? data.error : 'Could not establish the Workroom dashboard boundary.',
          response.status,
        );
      }
      if (workroomBootstrap === request) workroomBootstrapToken = data.token;
      return data.token;
    }).catch((error) => {
      if (workroomBootstrap === request) {
        workroomBootstrap = undefined;
        workroomBootstrapToken = undefined;
      }
      throw error;
    });
    workroomBootstrap = request;
  }
  return workroomBootstrap;
}

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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bootstrapToken = isWorkroomRequest(path) && path !== '/api/workrooms/bootstrap'
      ? await getWorkroomBootstrap()
      : undefined;
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(bootstrapToken ? {
          [WORKROOM_BOOTSTRAP_HEADER]: bootstrapToken,
          [LEGACY_WORKROOM_BOOTSTRAP_HEADER]: bootstrapToken,
        } : {}),
        ...init?.headers,
      },
    });

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json().catch(() => null) : null;
    const message =
      (data && typeof data.error === 'string' && data.error) || `Request failed (${res.status})`;
    if (!res.ok && attempt === 0 && res.status === 403 && isWorkroomRequest(path)
      && message.includes('same-origin dashboard bootstrap')) {
      // A backend restart rotates the in-memory bootstrap secret. The rejected
      // request never reached its route, so reacquiring and retrying once is safe
      // for both reads and mutations.
      if (workroomBootstrapToken === bootstrapToken) {
        workroomBootstrap = undefined;
        workroomBootstrapToken = undefined;
      }
      continue;
    }
    if (!res.ok) throw new ApiError(message, res.status);
    return data as T;
  }
  throw new ApiError('Could not re-establish the Workroom dashboard boundary.', 403);
}
