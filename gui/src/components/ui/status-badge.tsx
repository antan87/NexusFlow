import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * Compact status pill for workspace/repo/service states, including the
 * workspace mode tags (in-place / worktree). Tone names stay compatible with
 * the legacy StatusPill so migration is a rename.
 */
const statusBadgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
  {
    defaultVariants: {
      tone: "neutral",
    },
    variants: {
      tone: {
        success: "border-success/25 bg-success/10 text-success-foreground",
        warning: "border-warning/25 bg-warning/10 text-warning-foreground",
        danger: "border-destructive/25 bg-destructive/10 text-destructive-foreground",
        running: "border-running/25 bg-running/10 text-running-foreground",
        info: "border-info/25 bg-info/10 text-info-foreground",
        accent: "border-primary/25 bg-primary/10 text-primary",
        idle: "border-border bg-muted text-muted-foreground",
        neutral: "border-border bg-muted text-muted-foreground",
        "in-place": "border-running/25 bg-running/10 text-running-foreground",
        worktree: "border-primary/25 bg-primary/10 text-primary",
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
