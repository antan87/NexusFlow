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
  const lastJumpKeyRef = useRef<string>('');

  useEffect(() => {
    if (!containerRef.current || !targetLine || targetLine <= 0) return;
    const jumpKey = `${targetLine}:${jumpNonce ?? 0}`;
    if (lastJumpKeyRef.current === jumpKey) return;
    lastJumpKeyRef.current = jumpKey;

    const el = containerRef.current.querySelector<HTMLElement>(`[data-mod-line="${targetLine}"]`) ||
      containerRef.current.querySelector<HTMLElement>(`[data-orig-line="${targetLine}"]`) ||
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
      let marker = ' ';
      let content = line;

      if (line.startsWith('@@')) {
        bgClass = 'bg-sky-500/15';
        textClass = 'text-info-foreground font-bold italic';
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
        marker = ' ';
        content = line;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        bgClass = 'bg-emerald-500/15';
        textClass = 'text-success-foreground font-semibold';
        currentModLine++;
        lineModNum = currentModLine;
        marker = '+';
        content = line.slice(1);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        bgClass = 'bg-rose-500/15';
        textClass = 'text-destructive-foreground font-semibold';
        currentOrigLine++;
        lineOrigNum = currentOrigLine;
        marker = '-';
        content = line.slice(1);
      } else if (line.startsWith(' ')) {
        currentOrigLine++;
        currentModLine++;
        lineOrigNum = currentOrigLine;
        lineModNum = currentModLine;
        marker = ' ';
        content = line.slice(1);
      }

      const isTarget = targetLine !== undefined && (
        lineModNum === targetLine ||
        (lineModNum === undefined && lineOrigNum === targetLine)
      );

      return {
        idx,
        line,
        content,
        marker,
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
          className={`flex py-0.5 border-l-2 transition-colors hover:bg-accent/40 ${
            item.isTarget
              ? 'bg-primary/25 border-primary font-bold'
              : 'border-transparent ' + item.bgClass
          }`}
        >
          <span className="w-12 shrink-0 select-none text-right pr-2 text-[10px] font-mono text-muted-foreground/70 border-r border-border/40">
            {item.lineOrigNum ?? ''}
          </span>
          <span className="w-12 shrink-0 select-none text-right pr-2 text-[10px] font-mono text-muted-foreground/70 border-r border-border/40">
            {item.lineModNum ?? ''}
          </span>
          <span
            data-diff-marker={item.marker.trim() || undefined}
            className={`w-5 shrink-0 select-none text-center font-bold font-mono text-xs border-r border-border/40 ${
              item.marker === '+'
                ? 'text-success-foreground'
                : item.marker === '-'
                  ? 'text-destructive-foreground'
                  : 'text-muted-foreground/40'
            }`}
          >
            {item.marker}
          </span>
          <span className={`pl-2 pr-3 whitespace-pre flex-1 ${item.textClass}`}>{item.content}</span>
        </div>
      ))}
    </div>
  );
};
