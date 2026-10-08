import { useSyncExternalStore } from 'react';

/** A repository file, as the server's reference resolver names it. */
export interface RepoFile {
  repoName: string;
  repoPath: string;
  file: string;
}

/**
 * What the Code section is asked to show. A clicked path is answered at once with `locating`, so the
 * click always visibly does something, and then with what the server found: the file, the files it
 * could mean, or why there is none.
 */
export type CodeRequest =
  | { kind: 'locating'; path: string; line?: number }
  | ({ kind: 'file'; line?: number } & RepoFile)
  | { kind: 'ambiguous'; path: string; line?: number; candidates: RepoFile[] }
  | { kind: 'not-found'; path: string; line?: number; reason: 'missing' | 'directory' | 'outside-repositories' | 'error'; absolutePath?: string; message?: string };

export interface OpenRequest<T> {
  /** Grows with every request, so asking for the same file twice still counts as a new request. */
  id: number;
  request: T;
}

/**
 * Requests to open something in a workspace's side panel. The terminal and the progress strip live
 * in the chat dock, above the router, while the Code and Docs sections live in the page; this is
 * how one hands the other a path. The latest request per workspace is kept, so a section that
 * mounts after the click still sees it.
 */
function createRequestStore<T>() {
  const latest = new Map<string, OpenRequest<T>>();
  const listeners = new Set<() => void>();
  let counter = 0;
  return {
    open(workspace: string, request: T): number {
      counter += 1;
      latest.set(workspace, { id: counter, request });
      for (const listener of listeners) listener();
      return counter;
    },
    get(workspace: string): OpenRequest<T> | null {
      return latest.get(workspace) ?? null;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const codeRequests = createRequestStore<CodeRequest>();
export const documentRequests = createRequestStore<{ name: string }>();

export function useCodeRequest(workspace: string): OpenRequest<CodeRequest> | null {
  return useSyncExternalStore(codeRequests.subscribe, () => codeRequests.get(workspace), () => null);
}

export function useDocumentRequest(workspace: string): OpenRequest<{ name: string }> | null {
  return useSyncExternalStore(documentRequests.subscribe, () => documentRequests.get(workspace), () => null);
}
