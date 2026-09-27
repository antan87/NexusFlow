/**
 * FallbackDiffAdapter Component: Lightweight fallback diff view that runs with zero web workers.
 * File: gui/src/features/changes/adapters/FallbackDiffAdapter.tsx
 */
import React, { useEffect, useRef, useMemo } from 'react';
import type { DiffAdapterRenderProps } from '../types.js';

export interface FallbackDiffAdapterProps extends DiffAdapterRenderProps {
  targetLine?: number;
  jumpNonce?: number;
}

export const FallbackDiffAdapter: React.FC<FallbackDiffAdapterProps> = ({
  patchText,
  targetLine,
  jumpNonce,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastJumpNonceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current || !targetLine || targetLine <= 0) return;
    if (lastJumpNonceRef.current === jumpNonce) return;
    lastJumpNonceRef.current = jumpNonce;

    const el = containerRef.current.querySelector<HTMLElement>(`[data-mod-line="${targetLine}"]`) ||
      containerRef.current.querySelector<HTMLElement>('[data-is-target="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [targetLine, jumpNonce]);

  const renderedLines = useMemo(() => {
    if (!patchText || !patchText.trim()) return [];
    const lines = patchText.split(/\r?\n/);
    // Both sides are tracked. Only the modified side used to advance, so a
    // deleted line had no number at all and fell back to its index in this
    // array, which read as a plausible but wrong file line next to the correct
    // ones in the same column.
    let currentOrigLine = 0;
    let currentModLine = 0;

    return lines.map((line, idx) => {
      let bgClass = '';
      let textClass = 'text-muted-foreground';
      let lineOrigNum: number | undefined;
      let lineModNum: number | undefined;

      if (line.startsWith('@@')) {
        bgClass = 'bg-sky-500/15';
        textClass = 'text-sky-400 font-bold italic';
        const orig = line.match(/-(\d+)/);
        if (orig?.[1]) {
          currentOrigLine = parseInt(orig[1], 10) - 1;
          lineOrigNum = currentOrigLine + 1;
        }
        const mod = line.match(/\+(\d+)/);
        if (mod?.[1]) {
          currentModLine = parseInt(mod[1], 10) - 1;
          lineModNum = currentModLine + 1;
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        bgClass = 'bg-emerald-500/15';
        textClass = 'text-emerald-400 font-semibold';
        currentModLine++;
        lineModNum = currentModLine;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        bgClass = 'bg-rose-500/15';
        textClass = 'text-rose-400 font-semibold';
        currentOrigLine++;
        lineOrigNum = currentOrigLine;
      } else if (line.startsWith(' ')) {
        currentOrigLine++;
        currentModLine++;
        lineOrigNum = currentOrigLine;
        lineModNum = currentModLine;
      }

      const isTarget = targetLine !== undefined && lineModNum === targetLine;

      return {
        idx,
        line,
        lineOrigNum,
        lineModNum,
        isTarget,
        bgClass,
        textClass,
      };
    });
  }, [patchText, targetLine]);

  if (!patchText || !patchText.trim()) {
    return (
      <div className="p-4 font-mono text-xs italic text-muted-foreground">
        No diff changes recorded.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="fallback-diff"
      className="custom-scrollbar h-full min-h-0 overflow-auto rounded-lg border border-border/80 bg-muted/20 font-mono text-xs leading-relaxed select-text"
    >
      {renderedLines.map((item) => (
        <div
          key={item.idx}
          // Every row carries both sides, so a deleted line is locatable and
          // reachable even though it has no position in the modified file.
          data-orig-line={item.lineOrigNum}
          data-mod-line={item.lineModNum}
          data-is-target={item.isTarget ? 'true' : undefined}
          className={`flex px-3 py-0.5 hover:bg-accent/40 ${item.isTarget ? 'bg-primary/25 border-l-2 border-primary font-bold' : item.bgClass}`}
        >
          <span className="w-10 select-none text-right pr-3 text-[10px] text-muted-foreground/60">
            {item.lineOrigNum ?? ''}
          </span>
          <span className="w-10 select-none text-right pr-3 text-[10px] text-muted-foreground/60">
            {item.lineModNum ?? ''}
          </span>
          <span className={`whitespace-pre flex-1 ${item.textClass}`}>{item.line}</span>
        </div>
      ))}
    </div>
  );
};
