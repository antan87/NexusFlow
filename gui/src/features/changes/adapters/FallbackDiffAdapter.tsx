/**
 * FallbackDiffAdapter Component: Lightweight fallback diff view that runs with zero web workers.
 * File: gui/src/features/changes/adapters/FallbackDiffAdapter.tsx
 */
import React, { useEffect, useRef, useMemo } from 'react';
import type { DiffAdapterRenderProps } from '../types.js';
import { classifyPatch } from '../utils/diffParser.js';

export interface FallbackDiffAdapterProps extends DiffAdapterRenderProps {
  targetLine?: number;
  targetOrigLine?: number;
  jumpNonce?: number;
}

export const FallbackDiffAdapter: React.FC<FallbackDiffAdapterProps> = ({
  patchText,
  targetLine,
  targetOrigLine,
  jumpNonce,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastJumpKeyRef = useRef<string>('');

  useEffect(() => {
    if (!containerRef.current) return;
    const hasModTarget = targetLine !== undefined && targetLine > 0;
    const hasOrigTarget = targetOrigLine !== undefined && targetOrigLine > 0;
    if (!hasModTarget && !hasOrigTarget) return;

    const jumpKey = `${targetLine ?? ''}:${targetOrigLine ?? ''}:${jumpNonce ?? 0}`;
    if (lastJumpKeyRef.current === jumpKey) return;
    lastJumpKeyRef.current = jumpKey;

    const el =
      (hasOrigTarget
        ? containerRef.current.querySelector<HTMLElement>(`[data-orig-line="${targetOrigLine}"][data-diff-marker="-"]`) ||
          containerRef.current.querySelector<HTMLElement>(`[data-orig-line="${targetOrigLine}"]`)
        : null) ||
      (hasModTarget
        ? containerRef.current.querySelector<HTMLElement>(`[data-mod-line="${targetLine}"]`)
        : null) ||
      containerRef.current.querySelector<HTMLElement>('[data-is-target="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [targetLine, targetOrigLine, jumpNonce]);

  const renderedLines = useMemo(() => {
    if (!patchText || !patchText.trim()) return [];
    // Line kinds and numbers come from the shared classifier: inside a hunk `--- x` is a removed
    // `-- x` line, not a file header, and every number is a real file line, never an array index.
    return classifyPatch(patchText).map(({ text: line, kind, origLine, modLine }, idx) => {
      let bgClass = '';
      let textClass = 'text-muted-foreground';
      const lineOrigNum = kind === 'header' || kind === 'meta' ? undefined : origLine;
      const lineModNum = kind === 'header' || kind === 'meta' ? undefined : modLine;
      let marker = ' ';
      let content = line;

      if (kind === 'hunk') {
        bgClass = 'bg-sky-500/15';
        textClass = 'text-info-foreground font-bold italic';
      } else if (kind === 'added') {
        bgClass = 'bg-emerald-500/15';
        textClass = 'text-success-foreground font-semibold';
        marker = '+';
        content = line.slice(1);
      } else if (kind === 'removed') {
        bgClass = 'bg-rose-500/15';
        textClass = 'text-destructive-foreground font-semibold';
        marker = '-';
        content = line.slice(1);
      } else if (kind === 'context') {
        content = line.slice(1);
      }

      const isTarget =
        (targetOrigLine !== undefined && lineOrigNum === targetOrigLine && lineModNum === undefined) ||
        (targetOrigLine === undefined && targetLine !== undefined && lineModNum === targetLine) ||
        (targetOrigLine === undefined && targetLine !== undefined && lineModNum === undefined && lineOrigNum === targetLine);

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
  }, [patchText, targetLine, targetOrigLine]);

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
          className={`flex min-w-full w-fit py-0.5 border-l-2 transition-colors hover:bg-accent/40 ${
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
