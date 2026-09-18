/**
 * Monaco Diff Adapter Component
 * Production-grade diff reviewer with DOM virtualization, Monarch syntax highlighting,
 * side-by-side / unified modes, targetLine jump support, and cross-file symbol navigation.
 * File: gui/src/features/changes/adapters/MonacoDiffAdapter.tsx
 */
import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/json/json.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution';
import type { DiffAdapterRenderProps } from '../types.js';
import { getLanguageFromPath } from '../utils/languageDetector.js';
import { ensureMonacoWorkerEnvironment } from '../utils/monacoWorkerSetup.js';
import { ensureMonacoNavigation } from '../utils/monacoNavigationSetup.js';
import { registerLightweightNavigationProviders } from '../utils/changesetSymbolIndex.js';
import {
  getModifiedFileUri,
  getOriginalFileUri,
  getOrCreateTextModel,
  registerCrossFileEditorOpener,
} from '../utils/changesetModelStore.js';

// Ensure web workers and navigation contributions are configured
ensureMonacoWorkerEnvironment();
ensureMonacoNavigation();
registerLightweightNavigationProviders(monaco);

export interface MonacoDiffAdapterProps extends DiffAdapterRenderProps {
  height?: string | number;
  repoName?: string;
  targetLine?: number;
  jumpNonce?: number;
  onOpenFile?: (repoName: string, filePath: string, line?: number) => void;
  onLineSelect?: (line: number) => void;
}

export const MonacoDiffAdapter: React.FC<MonacoDiffAdapterProps> = ({
  filePath,
  repoName = 'workspace',
  originalContent,
  modifiedContent,
  viewMode,
  ignoreWhitespace,
  height = 480,
  targetLine,
  jumpNonce,
  onOpenFile,
  onLineSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const decorationCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const modelsRef = useRef<{
    original: monaco.editor.ITextModel | null;
    modified: monaco.editor.ITextModel | null;
  }>({
    original: null,
    modified: null,
  });

  // Track targetLine jumps in modified buffer
  useEffect(() => {
    if (!editorInstanceRef.current || !targetLine || targetLine <= 0) return;
    const modifiedEditor = editorInstanceRef.current.getModifiedEditor();
    modifiedEditor.revealLineInCenter(targetLine);
    modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
    modifiedEditor.focus();

    // Flash highlight on the target line
    if (!decorationCollectionRef.current) {
      decorationCollectionRef.current = modifiedEditor.createDecorationsCollection();
    }
    decorationCollectionRef.current.set([
      {
        range: new monaco.Range(targetLine, 1, targetLine, 1),
        options: {
          isWholeLine: true,
          className: 'bg-primary/20 border-l-2 border-primary',
        },
      },
    ]);
  }, [targetLine, jumpNonce]);

  useEffect(() => {
    if (!containerRef.current) return;

    const language = getLanguageFromPath(filePath);

    // Create models with file:// and diff-original:// URIs for cross-file navigation
    const originalUri = getOriginalFileUri(repoName, filePath, monaco);
    const modifiedUri = getModifiedFileUri(repoName, filePath, monaco);

    const originalModel =
      getOrCreateTextModel(originalUri, originalContent, language, monaco) ||
      monaco.editor.createModel(originalContent, language);
    const modifiedModel =
      getOrCreateTextModel(modifiedUri, modifiedContent, language, monaco) ||
      monaco.editor.createModel(modifiedContent, language);
    modelsRef.current = { original: originalModel, modified: modifiedModel };

    // Register editor opener for cross-file definition jumps
    let openerDisposable: monaco.IDisposable | null = null;
    if (onOpenFile) {
      openerDisposable = registerCrossFileEditorOpener(onOpenFile, monaco);
    }

    // Instantiate Monaco Diff Editor
    const isDark =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') !== 'light';

    let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
    let cursorSub: monaco.IDisposable | null = null;

    try {
      diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        renderSideBySide: viewMode === 'side-by-side',
        ignoreTrimWhitespace: ignoreWhitespace,
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 3,
          minimumLineCount: 10,
          revealLineCount: 20,
        },
        renderIndicators: true,
        originalEditable: false,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: true, maxColumn: 60 },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          alwaysConsumeMouseWheel: false,
        },
        lineNumbersMinChars: 3,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', Consolas, Menlo, monospace",
        theme: isDark ? 'vs-dark' : 'vs',
        contextmenu: true,
      });

      diffEditor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      editorInstanceRef.current = diffEditor;

      // Track cursor changes to sync active hunk and line
      const modifiedEditor = diffEditor.getModifiedEditor();
      cursorSub = modifiedEditor.onDidChangeCursorPosition((e) => {
        onLineSelect?.(e.position.lineNumber);
      });

      // If an initial targetLine is supplied, reveal it immediately after mounting
      if (targetLine && targetLine > 0) {
        modifiedEditor.revealLineInCenter(targetLine);
        modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
      }
    } catch (err) {
      console.error('[MonacoDiffAdapter] Error initializing diff editor:', err);
    }

    // Cleanup: Strictly dispose listeners and editor widget to prevent memory leaks
    return () => {
      cursorSub?.dispose();
      openerDisposable?.dispose();
      diffEditor?.dispose();
      editorInstanceRef.current = null;
    };
  }, [filePath, repoName, originalContent, modifiedContent, viewMode, ignoreWhitespace, onOpenFile, onLineSelect, targetLine]);


  return (
    <div
      ref={containerRef}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
      className="w-full rounded-lg overflow-hidden border border-border/70 bg-background"
    />
  );
};
