import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type Tone = 'success' | 'warning' | 'danger' | 'running' | 'idle' | 'accent' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'text-success border-success/30 bg-success/10',
  warning: 'text-warning border-warning/30 bg-warning/10',
  danger: 'text-danger border-danger/30 bg-danger/10',
  running: 'text-running border-running/30 bg-running/10',
  idle: 'text-content-faint border-hairline bg-surface',
  accent: 'text-accent border-accent/30 bg-accent-soft',
  neutral: 'text-content-muted border-hairline bg-raised',
};

export function StatusPill({
  tone = 'neutral',
  dot,
  title,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap', TONES[tone])}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
