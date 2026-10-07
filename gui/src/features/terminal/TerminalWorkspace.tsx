import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ListTree, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { apiFetch } from '../../lib/api/client.js';
import { CHAT_GEOMETRY } from '../chat/floatingChatStore.js';
import { hasModifier, modifierLabel, usePaneHotkey } from './usePaneHotkey.js';
import { WorkspaceCodePanel } from '../changes/WorkspaceCodePanel.js';
import { SessionDeck } from './SessionDeck.js';
import { WorkspaceDocumentsInspector } from './WorkspaceDocumentsInspector.js';
import { isUnreadableDocument, workspaceDocumentName } from './documentReference.js';
import { isPathInsideWorkspace, isWebOrDomain, normalizeWebUrl } from './webLinks.js';
import { resolveFileReference } from '../changes/resolveFileReference.js';
import { WhereAreWeStrip } from '../progress/WhereAreWeStrip.js';

/** The inspector may never squeeze the terminal below this share of the pane. */
const INSPECTOR_MIN_PERCENT = 28;
const INSPECTOR_MAX_PERCENT = 80;
const clampPercent = (value: number) => Math.max(INSPECTOR_MIN_PERCENT, Math.min(INSPECTOR_MAX_PERCENT, value));

export function TerminalWorkspace({ workspacePath, repoPaths, ...props }: Pick<ComponentProps<typeof SessionDeck>, 'workspace' | 'active' | 'launch' | 'consumeLaunch' | 'onStatusChange' | 'onBackgroundOutput'> & { workspacePath: string; repoPaths?: string[] }) {
  const [inspector, setInspector] = useState<'code' | 'documents' | null>(null);
  const [openReference, setOpenReference] = useState<{ path: string; line?: number; id: number } | null>(null);
  const [openDocument, setOpenDocument] = useState<{ name: string; id: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [compact, setCompact] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const referenceRequest = useRef(0);
  // How the strip above the chat types a suggestion into the prompt. The pane fills it in once connected.
  const fillPromptRef = useRef<((text: string) => boolean) | null>(null);
  // How the strip hears that the developer replied in the chat, so it can close the question the AI asked.
  const replyRef = useRef<((target: string) => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < CHAT_GEOMETRY.compactBreakpointPx));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Panel switching is bound to modified keys so it still works while the PTY
  // owns the keyboard, and Escape closes whichever inspector is open.
  //
  // Gated on `active`: the window keeps every open tab mounted, so an ungated
  // listener would toggle the inspector on all of them at once.
  //
  // Code answers to Ctrl/Cmd+Shift+E. Shift+C is accepted as an alias, but the
  // terminal claims that combination for copy-selection and stops propagation,
  // so the alias only resolves when focus is outside the PTY. E is not used by
  // the terminal and therefore always works.
  usePaneHotkey((event) => {
    if (hasModifier(event, { shift: true })) {
      const key = event.key.toLowerCase();
      if (key === 'e' || key === 'c') {
        event.preventDefault();
        setInspector(current => (current === 'code' ? null : 'code'));
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        setInspector(current => (current === 'documents' ? null : 'documents'));
        return;
      }
    }
    if (event.key === 'Escape' && inspector) {
      event.preventDefault();
      setInspector(null);
    }
  }, { enabled: props.active });

  const handleSplitDrag = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    setIsDragging(true);

    const onPointerMove = (move: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const inspectorPercent = ((bounds.right - move.clientX) / bounds.width) * 100;
      setSplitPercent(Math.round(clampPercent(inspectorPercent)));
      setIsExpanded(false);
    };
    const onPointerUp = (up: PointerEvent) => {
      setIsDragging(false);
      if (target.hasPointerCapture(up.pointerId)) target.releasePointerCapture(up.pointerId);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
    };
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  }, []);

  const openFile = async (reference: { path: string; line?: number }) => {
    let cleanPath = reference.path.replace(/^<+|>+$/g, '').trim();
    if (!cleanPath) return;

    while (
      (/[,'"`\]};.!?)}>]$/.test(cleanPath) || (cleanPath.endsWith(':') && !/^[a-zA-Z]:$/.test(cleanPath)))
      && !/\(\d+(?:,\d+)?\)$/.test(cleanPath)
      && !/\]\([^)]+\)$/.test(cleanPath)
    ) {
      cleanPath = cleanPath.slice(0, -1).trim();
    }

    const mdMatch = /^\[([^\]]*)\]\((<[^>]+>|[^)]+)\)$/.exec(cleanPath);
    if (mdMatch) {
      cleanPath = mdMatch[2].trim();
      while (cleanPath.startsWith('<') && cleanPath.endsWith('>')) {
        cleanPath = cleanPath.slice(1, -1).trim();
      }
    }

    while (
      (/[,'"`\]};.!?)}>]$/.test(cleanPath) || (cleanPath.endsWith(':') && !/^[a-zA-Z]:$/.test(cleanPath)))
      && !/\(\d+(?:,\d+)?\)$/.test(cleanPath)
    ) {
      cleanPath = cleanPath.slice(0, -1).trim();
    }

    if (isWebOrDomain(cleanPath)) {
      window.open(normalizeWebUrl(cleanPath), '_blank', 'noopener,noreferrer');
      return;
    }

    let line = reference.line;
    const location = cleanPath.match(/:(\d+)(?::\d+)?$/)
      ?? cleanPath.match(/\((\d+)(?:,\d+)?\)$/)
      ?? cleanPath.match(/#L(\d+)(?:-L?\d+)?$/i);
    if (location) {
      cleanPath = cleanPath.slice(0, -location[0].length);
      const lineNumber = Number(location[1]);
      if (Number.isSafeInteger(lineNumber) && lineNumber > 0 && !line) {
        line = lineNumber;
      }
    }

    if (/^file:\/\//i.test(cleanPath)) {
      try {
        cleanPath = decodeURIComponent(new URL(cleanPath).pathname).replace(/^\/([a-z]:\/)/i, '$1');
      } catch {
        cleanPath = cleanPath.replace(/^file:\/\//i, '');
      }
    }

    cleanPath = cleanPath.replace(/#.*$/, '');

    if (!isPathInsideWorkspace(cleanPath, workspacePath, repoPaths)) {
      return;
    }

    const request = ++referenceRequest.current;
    const cleanRef = { path: cleanPath, line };
    const name = workspaceDocumentName(cleanRef, workspacePath, repoPaths);
    if (name) {
      const nested = name.includes('/');
      const documents = `/api/workspace/${encodeURIComponent(props.workspace)}/documents`;
      let isDocument: boolean;
      try {
        // Documents in folders are not in the root listing, so the server is asked to open them.
        isDocument = nested
          ? await apiFetch(`${documents}/preview?name=${encodeURIComponent(name)}`).then(() => true)
          : (await apiFetch<{ documents: { name: string }[] }>(documents)).documents.some(document => document.name === name);
      } catch (error) {
        // A nested file the server found but cannot preview still belongs in the inspector, which
        // says why. Anything else is not a workspace document; the code panel can still resolve a repository file.
        isDocument = nested && isUnreadableDocument(error);
      }
      if (request !== referenceRequest.current) return;
      if (isDocument) {
        setOpenDocument(current => ({ name, id: (current?.id ?? 0) + 1 }));
        setInspector('documents');
        return;
      }
    }

    try {
      const changesRes = await apiFetch<{ changes?: { repoName: string; repoPath: string; files: { file: string }[] }[] }>(
        `/api/workspace/${encodeURIComponent(props.workspace)}/changes?include=all`
      );
      if (request !== referenceRequest.current) return;
      const repos = changesRes?.changes;
      if (!repos || repos.length === 0) {
        return;
      }
      const resolved = resolveFileReference(cleanPath, repos);
      if (!resolved.file) {
        if (inspector === 'code') {
          setOpenReference(current => ({ ...cleanRef, id: (current?.id ?? 0) + 1 }));
        }
        return;
      }
    } catch {
      return;
    }

    if (request !== referenceRequest.current) return;
    setOpenReference(current => ({ ...cleanRef, id: (current?.id ?? 0) + 1 }));
    setInspector('code');
  };

  const codePanel = <WorkspaceCodePanel workspace={props.workspace} active={props.active} openReference={openReference} onClose={() => setInspector(null)} />;
  const documentsPanel = <WorkspaceDocumentsInspector workspace={props.workspace} workspacePath={workspacePath} active={props.active} openDocument={openDocument} />;
  const mod = modifierLabel();
  const codeShortcut = `${mod}+Shift+E`;

  // Documents have their place on the workspace rail; a document the CLI names in its output still opens here, beside
  // the terminal, and Ctrl/Cmd+Shift+D still toggles it, so there is no second Docs button.
  // The inspector controls live in the pane toolbar rather than in a bar of
  // their own, so the chat window shows one toolbar instead of two stacked
  // rows that each held a fragment of the same job.
  // Code and Docs stay inline in the toolbar rather than behind the overflow.
  // They are used constantly, so burying them behind a menu to save 60px was
  // the wrong trade. The full-width toggle only exists while an inspector is
  // open, so it appears next to them at that point.
  const inspectorControls = [
    <Button key="code" size="xs" variant={inspector === 'code' ? 'secondary' : 'ghost'} aria-pressed={inspector === 'code'} aria-keyshortcuts="Control+Shift+E Meta+Shift+E" title={`Toggle the code panel (${codeShortcut})`} onClick={() => setInspector(value => value === 'code' ? null : 'code')}>
      <ListTree className="size-3" />Code
    </Button>,
  ];
  const inspectorExpandControl = inspector && !compact
    ? <Button size="xs" variant={isExpanded ? 'secondary' : 'ghost'}
        onClick={() => setIsExpanded(value => !value)}
        aria-label={isExpanded ? 'Show terminal and inspector side by side' : 'Give the inspector the full width'}
        title={isExpanded ? 'Show terminal and inspector side by side' : 'Give the inspector the full width'}>
        {isExpanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
      </Button>
    : null;

  return <div className="flex h-full min-h-0 flex-col">
    <WhereAreWeStrip workspace={props.workspace} active={props.active} fillPrompt={text => fillPromptRef.current?.(text) ?? false} replyRef={replyRef} openFile={reference => { void openFile(reference); }} />
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-row">
      {/* The terminal stays mounted at every width. Below the compact
          breakpoint the inspector becomes a sheet over it, so opening Code or
          Docs no longer renames the control to "Back to CLI" and no longer
          costs the user their prompt. */}
      <div className="min-h-0 min-w-0 flex-1"><SessionDeck {...props} fillPromptRef={fillPromptRef} onReply={target => replyRef.current?.(target)} codeVisible={inspector !== null} inspectorControls={inspectorControls} inspectorExpandControl={inspectorExpandControl} onOpenFileReference={reference => { void openFile(reference); }} /></div>
      {inspector && <>
        {!compact && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-valuenow={isExpanded ? INSPECTOR_MAX_PERCENT : splitPercent}
          aria-valuemin={INSPECTOR_MIN_PERCENT} aria-valuemax={INSPECTOR_MAX_PERCENT} aria-label={inspector === 'code' ? 'Resize code panel' : 'Resize documents panel'} onPointerDown={handleSplitDrag}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setSplitPercent(percent => clampPercent(percent + (event.key === 'ArrowLeft' ? 5 : -5)));
              setIsExpanded(false);
            }
          }}
          className="group z-20 -mx-1 flex w-2 cursor-col-resize select-none items-center justify-center bg-border/60 transition-colors hover:w-2.5 hover:bg-primary/50 focus-visible:bg-primary/70 focus-visible:outline-hidden"
          title="Drag or use Left/Right arrow keys to resize the inspector">
          <div className="h-6 w-0.5 rounded bg-muted-foreground/30 group-hover:bg-primary" />
        </div>}
        {compact
          ? <div className="absolute inset-0 z-30 flex min-h-0 flex-col border-t border-border bg-card shadow-2xl">{inspector === 'code' ? codePanel : documentsPanel}</div>
          : <div style={{ width: isExpanded ? `${INSPECTOR_MAX_PERCENT}%` : `${splitPercent}%` }} className={`h-full min-h-0 min-w-0 border-l border-border ${isDragging ? '' : 'transition-[width] duration-150'}`}>
              {inspector === 'code' ? codePanel : documentsPanel}
            </div>}
      </>}
    </div>
  </div>;
}
