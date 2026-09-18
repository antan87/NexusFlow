/**
 * FallbackDiffAdapter Component: Lightweight fallback diff view that runs with zero web workers.
 * File: gui/src/features/changes/adapters/FallbackDiffAdapter.tsx
 */
import React from 'react';
import type { DiffAdapterRenderProps } from '../types.js';

export const FallbackDiffAdapter: React.FC<DiffAdapterRenderProps> = ({
  patchText,
}) => {
  if (!patchText || !patchText.trim()) {
    return (
      <div className="p-4 font-mono text-xs italic text-muted-foreground">
        No diff changes recorded.
      </div>
    );
  }

  const lines = patchText.split(/\r?\n/);

  return (
    <div className="custom-scrollbar max-h-[480px] overflow-auto rounded-lg border border-border/80 bg-muted/20 font-mono text-xs leading-relaxed select-text">
      {lines.map((line, idx) => {
        let bgClass = '';
        let textClass = 'text-muted-foreground';

        if (line.startsWith('+') && !line.startsWith('+++')) {
          bgClass = 'bg-emerald-500/15';
          textClass = 'text-emerald-400 font-semibold';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          bgClass = 'bg-rose-500/15';
          textClass = 'text-rose-400 font-semibold';
        } else if (line.startsWith('@@')) {
          bgClass = 'bg-sky-500/15';
          textClass = 'text-sky-400 font-bold italic';
        }

        return (
          <div key={idx} className={`flex px-3 py-0.5 hover:bg-accent/40 ${bgClass}`}>
            <span className="w-10 select-none text-right pr-3 text-[10px] text-muted-foreground/60">
              {idx + 1}
            </span>
            <span className={`whitespace-pre flex-1 ${textClass}`}>{line}</span>
          </div>
        );
      })}
    </div>
  );
};
