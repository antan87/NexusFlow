/**
 * Base URL for backend API calls.
 *
 * When the GUI is served by the Hono backend itself (browser dashboard), a
 * relative URL works. In the Vite dev server and in the packaged Neutralino
 * desktop app the GUI is served from a different origin, so calls must target
 * the backend explicitly. Every component must import this instead of
 * re-deriving it — a partial check (e.g. missing the Neutralino case) silently
 * breaks only the calls in that component.
 */
export const API_BASE: string =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && (window as any).Neutralino)
    ? 'http://localhost:3000'
    : '';
