/**
 * Changeset Text Model Store: Manages multi-file Monaco TextModels with consistent file:// and diff-original:// URIs
 * File: gui/src/features/changes/utils/changesetModelStore.ts
 */
import type * as monaco from 'monaco-editor';

/**
 * Resolves the active Monaco API instance safely, preferring explicitly passed API,
 * falling back to window.monaco if it contains editor, and finally defaulting to the imported module.
 */
function resolveMonaco(monacoApi?: typeof monaco): typeof monaco | undefined {
  if (monacoApi?.editor) return monacoApi;
  if (typeof window !== 'undefined' && (window as any).monaco?.editor) {
    return (window as any).monaco;
  }
  return undefined;
}

export function getCleanPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\//, '');
}

export function getCleanRepo(repoName: string): string {
  return repoName.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

export function getModifiedFileUri(repoName: string, filePath: string, monacoApi?: typeof monaco): monaco.Uri {
  const cleanRepo = getCleanRepo(repoName);
  const cleanPath = getCleanPath(filePath);
  const uriString = `file:///${cleanRepo}/${cleanPath}`;

  const m = resolveMonaco(monacoApi);
  if (m?.Uri?.parse) {
    return m.Uri.parse(uriString);
  }

  const pathString = `/${cleanRepo}/${cleanPath}`;
  return {
    scheme: 'file',
    authority: '',
    path: pathString,
    query: '',
    fragment: '',
    fsPath: pathString,
    with: () => ({} as any),
    toString: () => uriString,
    toJSON: () => uriString,
  } as unknown as monaco.Uri;
}

export function getOriginalFileUri(repoName: string, filePath: string, monacoApi?: typeof monaco): monaco.Uri {
  const cleanRepo = getCleanRepo(repoName);
  const cleanPath = getCleanPath(filePath);
  const uriString = `diff-original:///${cleanRepo}/${cleanPath}`;

  const m = resolveMonaco(monacoApi);
  if (m?.Uri?.parse) {
    return m.Uri.parse(uriString);
  }

  const pathString = `/${cleanRepo}/${cleanPath}`;
  return {
    scheme: 'diff-original',
    authority: '',
    path: pathString,
    query: '',
    fragment: '',
    fsPath: pathString,
    with: () => ({} as any),
    toString: () => uriString,
    toJSON: () => uriString,
  } as unknown as monaco.Uri;
}

/**
 * Creates or retrieves a persistent text model for a file in the changeset.
 */
export function getOrCreateTextModel(
  uri: monaco.Uri,
  content: string,
  language: string,
  monacoApi?: typeof monaco
): monaco.editor.ITextModel {
  const m = resolveMonaco(monacoApi);
  if (!m?.editor) return null as any;

  try {
    let model = m.editor.getModel(uri);
    if (!model || model.isDisposed()) {
      model = m.editor.createModel(content, language, uri);
    } else if (model.getValue() !== content) {
      model.setValue(content);
    }
    return model;
  } catch (err) {
    console.warn('[changesetModelStore] Error in getOrCreateTextModel:', err);
    try {
      return m.editor.getModel(uri) || m.editor.createModel(content, language);
    } catch {
      return null as any;
    }
  }
}

/**
 * Disposes all models with file:// or diff-original:// schemes to prevent memory leaks.
 */
export function disposeAllChangesetModels(monacoApi?: typeof monaco): void {
  const m = resolveMonaco(monacoApi);
  if (!m?.editor) return;

  try {
    for (const model of m.editor.getModels()) {
      if (model.uri.scheme === 'file' || model.uri.scheme === 'diff-original') {
        model.dispose();
      }
    }
  } catch (err) {
    console.warn('[changesetModelStore] Error disposing models:', err);
  }
}

export type OpenFileCallback = (repoName: string, filePath: string, line?: number) => void;

/**
 * Registers an editor opener with Monaco to coordinate cross-file definition navigation.
 */
export function registerCrossFileEditorOpener(
  onOpenFile: OpenFileCallback,
  monacoApi?: typeof monaco
): monaco.IDisposable {
  const m = resolveMonaco(monacoApi);
  if (!m?.editor?.registerEditorOpener) return { dispose: () => {} };

  try {
    return m.editor.registerEditorOpener({
      openCodeEditor(_source: any, resource: monaco.Uri, selectionOrPosition: any) {
        if (!resource || resource.scheme !== 'file') return false;

        // Extract repoName and relative filePath from URI path: /repoName/path/to/file.ts
        const normalizedPath = resource.path.replace(/^\//, '');
        const slashIndex = normalizedPath.indexOf('/');
        if (slashIndex === -1) return false;

        const repoName = normalizedPath.substring(0, slashIndex);
        const filePath = normalizedPath.substring(slashIndex + 1);

        let targetLine: number | undefined;
        if (selectionOrPosition) {
          if ('lineNumber' in selectionOrPosition && typeof selectionOrPosition.lineNumber === 'number') {
            targetLine = selectionOrPosition.lineNumber;
          } else if ('startLineNumber' in selectionOrPosition && typeof selectionOrPosition.startLineNumber === 'number') {
            targetLine = selectionOrPosition.startLineNumber;
          }
        }

        onOpenFile(repoName, filePath, targetLine);
        return true;
      },
    });
  } catch (err) {
    console.warn('[changesetModelStore] Failed to register editor opener:', err);
    return { dispose: () => {} };
  }
}
