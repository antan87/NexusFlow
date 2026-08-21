import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * Compact status pill for workspace/repo/service states, including the
 * workspace mode tags (in-place / worktree). Tone names stay compatible with
 * the legacy StatusPill so migration is a rename.
 */
const statusBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-[11px] tracking-tight transition-colors",
  {
    defaultVariants: {
      tone: "neutral",
    },
    variants: {
      tone: {
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300",
        warning: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300",
        danger: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300",
        running: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-300",
        info: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-300",
        accent: "border-primary/25 bg-primary/10 text-primary",
        idle: "border-border/70 bg-muted/60 text-muted-foreground",
        neutral: "border-border/70 bg-muted/60 text-muted-foreground",
        "in-place": "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-300 font-mono text-[10px]",
        worktree: "border-primary/20 bg-primary/10 text-primary font-mono text-[10px]",
      },
    },
  },
);

interface StatusBadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof statusBadgeVariants> {
  /** Show a small tone-colored dot before the label. */
  dot?: boolean;
}

function StatusBadge({ className, tone, dot = true, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ className, tone }))} data-slot="status-badge" {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants };
