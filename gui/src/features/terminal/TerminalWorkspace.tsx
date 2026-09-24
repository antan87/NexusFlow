import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { FileText, ListTree, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { apiFetch } from '../../lib/api/client.js';
import { WorkspaceCodePanel } from '../changes/WorkspaceCodePanel.js';
import { TerminalPane } from './TerminalPane.js';
import { WorkspaceDocumentsInspector } from './WorkspaceDocumentsInspector.js';
import { WorkspaceContextPeek } from './WorkspaceContextPeek.js';

export function TerminalWorkspace({ workspacePath, ...props }: ComponentProps<typeof TerminalPane> & { workspacePath: string }) {
  const [inspector, setInspector] = useState<'code' | 'documents' | null>(null);
  const [openReference, setOpenReference] = useState<{ path: string; line?: number; id: number } | null>(null);
  const [openDocument, setOpenDocument] = useState<{ name: string; id: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [compact, setCompact] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const referenceRequest = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 720));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
      setSplitPercent(Math.round(Math.max(20, Math.min(85, inspectorPercent))));
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
    const request = ++referenceRequest.current;
    const normalized = reference.path.replaceAll('\\', '/').replace(/^\.\//, '');
    const root = workspacePath.replaceAll('\\', '/').replace(/\/$/, '');
    const relative = normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
    if (!relative.includes('/')) {
      try {
        const result = await apiFetch<{ documents: { name: string }[] }>(`/api/workspace/${encodeURIComponent(props.workspace)}/documents`);
        if (request !== referenceRequest.current) return;
        if (result.documents.some(document => document.name === relative)) {
          setOpenDocument(current => ({ name: relative, id: (current?.id ?? 0) + 1 }));
          setInspector('documents');
          return;
        }
      } catch { /* The code panel can still resolve a repository file. */ }
    }
    if (request !== referenceRequest.current) return;
    setOpenReference(current => ({ ...reference, id: (current?.id ?? 0) + 1 }));
    setInspector('code');
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/10 px-2 py-1">
      <span className="text-[11px] font-semibold text-foreground">CLI chat</span>
      <div className="flex items-center gap-1">
        {inspector && !compact && <Button size="xs" variant={isExpanded ? 'secondary' : 'ghost'}
          onClick={() => setIsExpanded(value => !value)}
          aria-label={isExpanded ? 'Split view' : `Expand ${inspector} panel`}
          title={isExpanded ? 'Restore split view' : `Expand ${inspector} panel`}>
          {isExpanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          {isExpanded ? 'Split view' : 'Expand'}
        </Button>}
        <Button size="xs" variant={inspector === 'code' ? 'secondary' : 'ghost'} aria-pressed={inspector === 'code'} onClick={() => setInspector(value => value === 'code' ? null : 'code')}><ListTree className="size-3" />{inspector === 'code' ? compact ? 'Back to CLI' : 'Hide code' : 'Show code'}</Button>
        <Button size="xs" variant={inspector === 'documents' ? 'secondary' : 'ghost'} aria-pressed={inspector === 'documents'} onClick={() => setInspector(value => value === 'documents' ? null : 'documents')}><FileText className="size-3" />{inspector === 'documents' && compact ? 'Back to CLI' : 'Documents'}</Button>
      </div>
    </div>
    <WorkspaceContextPeek workspace={props.workspace} active={props.active} />
    <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-row">
      <div className={`min-h-0 min-w-0 flex-1 ${compact && inspector ? 'hidden' : ''}`}><TerminalPane {...props} active={props.active && !(compact && inspector)} codeVisible={inspector !== null} onOpenFileReference={reference => { void openFile(reference); }} /></div>
      {inspector && <>
        {!compact && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-valuenow={isExpanded ? 85 : splitPercent}
          aria-valuemin={20} aria-valuemax={85} aria-label={inspector === 'code' ? 'Resize code panel' : 'Resize documents panel'} onPointerDown={handleSplitDrag}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setSplitPercent(percent => Math.max(20, Math.min(85, percent + (event.key === 'ArrowLeft' ? 5 : -5))));
              setIsExpanded(false);
            }
          }}
          className="group z-20 -mx-1 flex w-2 cursor-col-resize select-none items-center justify-center bg-border/60 transition-colors hover:w-2.5 hover:bg-primary/50 focus-visible:bg-primary/70 focus-visible:outline-hidden"
          title="Drag or use Left/Right arrow keys to resize the inspector">
          <div className="h-6 w-0.5 rounded bg-muted-foreground/30 group-hover:bg-primary" />
        </div>}
        <div style={{ width: compact ? '100%' : isExpanded ? '85%' : `${splitPercent}%` }} className={`h-full min-h-0 min-w-0 ${compact ? '' : 'border-l'} border-border ${isDragging ? '' : 'transition-[width] duration-150'}`}>
          {inspector === 'code' ? <WorkspaceCodePanel workspace={props.workspace} active={props.active} openReference={openReference} onClose={() => setInspector(null)} />
            : <WorkspaceDocumentsInspector workspace={props.workspace} openDocument={openDocument} />}
        </div>
      </>}
    </div>
  </div>;
}
