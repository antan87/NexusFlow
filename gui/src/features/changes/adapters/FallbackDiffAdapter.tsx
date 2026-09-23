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
    let currentModLine = 0;

    return lines.map((line, idx) => {
      let bgClass = '';
      let textClass = 'text-muted-foreground';
      let lineModNum: number | undefined;

      if (line.startsWith('@@')) {
        bgClass = 'bg-sky-500/15';
        textClass = 'text-sky-400 font-bold italic';
        const match = line.match(/\+(\d+)/);
        if (match && match[1]) {
          currentModLine = parseInt(match[1], 10) - 1;
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        bgClass = 'bg-emerald-500/15';
        textClass = 'text-emerald-400 font-semibold';
        currentModLine++;
        lineModNum = currentModLine;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        bgClass = 'bg-rose-500/15';
        textClass = 'text-rose-400 font-semibold';
      } else if (line.startsWith(' ')) {
        currentModLine++;
        lineModNum = currentModLine;
      }

      const isTarget = targetLine !== undefined && lineModNum === targetLine;

      return {
        idx,
        line,
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
      className="custom-scrollbar h-full min-h-0 overflow-auto rounded-lg border border-border/80 bg-muted/20 font-mono text-xs leading-relaxed select-text"
    >
      {renderedLines.map((item) => (
        <div
          key={item.idx}
          data-mod-line={item.lineModNum}
          data-is-target={item.isTarget ? 'true' : undefined}
          className={`flex px-3 py-0.5 hover:bg-accent/40 ${item.isTarget ? 'bg-primary/25 border-l-2 border-primary font-bold' : item.bgClass}`}
        >
          <span className="w-10 select-none text-right pr-3 text-[10px] text-muted-foreground/60">
            {item.lineModNum ?? item.idx + 1}
          </span>
          <span className={`whitespace-pre flex-1 ${item.textClass}`}>{item.line}</span>
        </div>
      ))}
    </div>
  );
};
