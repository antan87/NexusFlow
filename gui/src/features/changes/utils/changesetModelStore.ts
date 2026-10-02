/**
 * Changeset Text Model Store: Manages multi-file Monaco TextModels with consistent file:// and diff-original:// URIs
 * File: gui/src/features/changes/utils/changesetModelStore.ts
 */
import type * as monaco from 'monaco-editor';

// The Monaco API last handed to this store. The app bundles Monaco as a module
// and never sets window.monaco, and importing it here would pull the whole
// editor out of its lazy chunk, so disposal reaches Monaco through this.
let knownMonaco: typeof monaco | undefined;

/**
 * Resolves the active Monaco API instance safely, preferring explicitly passed API,
 * then the one this store has already been given, then window.monaco if it contains editor.
 */
function resolveMonaco(monacoApi?: typeof monaco): typeof monaco | undefined {
  if (monacoApi?.editor) {
    knownMonaco = monacoApi;
    return monacoApi;
  }
  if (knownMonaco?.editor) return knownMonaco;
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
 * The models a live editor still holds. Monaco reports an error when a model is
 * disposed under an editor, so those are never disposed here: whoever holds one
 * is using it (it may even be another workspace's viewer sharing the same URI).
 */
function modelsHeldByEditors(m: typeof monaco): Set<monaco.editor.ITextModel> {
  const held = new Set<monaco.editor.ITextModel>();
  try {
    for (const diffEditor of m.editor.getDiffEditors?.() ?? []) {
      const pair = diffEditor.getModel();
      if (pair?.original) held.add(pair.original);
      if (pair?.modified) held.add(pair.modified);
    }
    for (const editor of m.editor.getEditors?.() ?? []) {
      const model = editor.getModel();
      if (model) held.add(model);
    }
  } catch {
    // If the editors cannot be listed there is nothing better to go on.
  }
  return held;
}

/**
 * Disposes the models of one file, for example once it has left the changeset.
 * A file with no models is not an error, and a model an editor still holds is left alone.
 */
export function disposeChangesetModelsFor(repoName: string, filePath: string, monacoApi?: typeof monaco): void {
  const m = resolveMonaco(monacoApi);
  if (!m?.editor) return;

  const held = modelsHeldByEditors(m);
  for (const uri of [getModifiedFileUri(repoName, filePath, m), getOriginalFileUri(repoName, filePath, m)]) {
    try {
      const model = m.editor.getModel(uri);
      if (model && !model.isDisposed() && !held.has(model)) model.dispose();
    } catch (err) {
      console.warn('[changesetModelStore] Error disposing model:', err);
    }
  }
}

/**
 * Disposes the models of several files once the current cleanup pass is over.
 * Monaco reports an error when a model is disposed while a diff editor still
 * holds it, and the editors that unmount together with their owner only release
 * their models after the owner's own cleanup has run.
 */
export function disposeChangesetModelsAfterEditors(
  files: ReadonlyArray<{ repoName: string; file: string }>,
  monacoApi?: typeof monaco,
): void {
  if (files.length === 0) return;
  const owned = files.map(({ repoName, file }) => ({ repoName, file }));
  setTimeout(() => {
    for (const { repoName, file } of owned) disposeChangesetModelsFor(repoName, file, monacoApi);
  }, 0);
}

/**
 * Disposes all models with file:// or diff-original:// schemes to prevent memory leaks.
 */
export function disposeAllChangesetModels(monacoApi?: typeof monaco): void {
  const m = resolveMonaco(monacoApi);
  if (!m?.editor) return;

  try {
    const held = modelsHeldByEditors(m);
    for (const model of m.editor.getModels()) {
      if ((model.uri.scheme === 'file' || model.uri.scheme === 'diff-original') && !held.has(model)) {
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
