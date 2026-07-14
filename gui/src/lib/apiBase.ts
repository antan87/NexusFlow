/**
 * Base URL for backend API calls.
 *
 * Used by the GUI to connect to the backend. In Electron, this can be
 * localhost if we run a local Hono server, or mapped via IPC.
 */
export const API_BASE: string = import.meta.env.DEV ? 'http://localhost:3000' : '';
