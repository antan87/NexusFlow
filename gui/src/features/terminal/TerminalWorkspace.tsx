import { useState, useRef, useCallback, type ComponentProps } from 'react';
import { ListTree, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { WorkspaceCodePanel } from '../changes/WorkspaceCodePanel.js';
import { TerminalPane } from './TerminalPane.js';

export function TerminalWorkspace(props: ComponentProps<typeof TerminalPane>) {
  const [showCode, setShowCode] = useState(false);
  const [openReference, setOpenReference] = useState<{ path: string; line?: number; id: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSplitDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const mouseX = ev.clientX - rect.left;
      const leftPercent = (mouseX / rect.width) * 100;
      // Clamp code width between 20% and 85%
      const newCodeWidth = Math.max(20, Math.min(85, 100 - leftPercent));
      setSplitPercent(Math.round(newCodeWidth));
      setIsExpanded(false);
    };

    const onPointerUp = (ev: PointerEvent) => {
      setIsDragging(false);
      try {
        if (target.hasPointerCapture(ev.pointerId)) {
          target.releasePointerCapture(ev.pointerId);
        }
      } catch {
        // Pointer capture already released or invalid
      }
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  }, []);

  const codeWidthStyle = isExpanded ? '85%' : `${splitPercent}%`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 bg-muted/10">
        <span className="text-[11px] font-semibold text-foreground">CLI chat</span>
        <div className="flex items-center gap-1">
          {showCode && (
            <Button
              size="xs"
              variant={isExpanded ? 'secondary' : 'ghost'}
              onClick={() => setIsExpanded(v => !v)}
              title={isExpanded ? 'Restore split view' : 'Focus code view (expand width)'}
              aria-label={isExpanded ? 'Split view' : 'Expand code'}
            >
              {isExpanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              {isExpanded ? 'Split view' : 'Expand code'}
            </Button>
          )}
          <Button
            size="xs"
            variant={showCode ? 'secondary' : 'ghost'}
            aria-pressed={showCode}
            onClick={() => setShowCode(value => !value)}
          >
            <ListTree className="size-3" />
            {showCode ? 'Hide code' : 'Show code'}
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-row relative">
        <div className="min-h-0 min-w-0 flex-1">
          <TerminalPane
            {...props}
            codeVisible={showCode}
            onOpenFileReference={reference => {
              setOpenReference(current => ({ ...reference, id: (current?.id ?? 0) + 1 }));
              setShowCode(true);
            }}
          />
        </div>

        {showCode && (
          <>
            {/* Draggable Divider */}
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-valuenow={isExpanded ? 85 : splitPercent}
              aria-valuemin={20}
              aria-valuemax={85}
              aria-label="Resize code panel"
              onPointerDown={handleSplitDrag}
              onKeyDown={e => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setSplitPercent(p => Math.min(85, p + 5));
                  setIsExpanded(false);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setSplitPercent(p => Math.max(20, p - 5));
                  setIsExpanded(false);
                }
              }}
              className={`w-2 hover:w-2.5 -mx-1 bg-border/60 hover:bg-primary/50 cursor-col-resize select-none flex items-center justify-center group focus-visible:outline-hidden focus-visible:bg-primary/70 z-20 transition-colors ${
                isDragging ? 'bg-primary/60 w-2.5' : ''
              }`}
              title="Drag or use Left/Right arrow keys to resize code panel"
            >
              <div className="w-0.5 h-6 bg-muted-foreground/30 group-hover:bg-primary rounded" />
            </div>

            <div
              style={{ width: codeWidthStyle }}
              className={`h-full min-h-0 min-w-0 border-l border-border ${
                isDragging ? '' : 'transition-[width] duration-150'
              }`}
            >
              <WorkspaceCodePanel
                workspace={props.workspace}
                active={props.active}
                openReference={openReference}
                onClose={() => setShowCode(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
