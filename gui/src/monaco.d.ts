/**
 * Type declarations for subpath imports of monaco-editor.
 */
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}

declare module 'monaco-editor/esm/vs/basic-languages/*' {
  const content: unknown;
  export default content;
}

declare module 'monaco-editor/esm/vs/languages/definitions/_.contribution.js' {
  export interface LanguageDefinition {
    id: string;
    extensions?: string[];
    filenames?: string[];
    firstLOF?: string[];
    aliases?: string[];
    mimetypes?: string[];
    def?: unknown;
    loader?: () => Promise<unknown>;
  }
  export function registerLanguage(def: LanguageDefinition): void;
}
