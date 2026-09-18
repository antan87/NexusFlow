/**
 * Lightweight Monaco Environment initialization
 * Registers solely editorWorker for Myers/LCS diffing; strictly omits heavy tsWorker (~11MB saving).
 * File: gui/src/features/changes/utils/monacoWorkerSetup.ts
 */
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (_moduleId: unknown, _label: string) => Worker;
    };
  }
}

let initialized = false;

export function ensureMonacoWorkerEnvironment(): void {
  if (initialized || typeof window === 'undefined') return;

  window.MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };

  initialized = true;
}
