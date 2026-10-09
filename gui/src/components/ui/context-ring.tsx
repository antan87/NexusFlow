import type * as React from "react";

import { RING_VIEWBOX, buildRing, describeRing, type RingMilestone } from "../../features/progress/ringGeometry";
import { cn } from "../../lib/utils";

interface ContextRingProps extends Omit<React.ComponentProps<"svg">, "children" | "viewBox" | "role"> {
  milestones: readonly RingMilestone[];
  /** Pixel size. The ring stays legible down to 18. */
  size?: number;
  /** Which milestone carries the "you are here" marker. */
  currentIndex?: number;
  /** Replaces the generated description for screen readers. */
  label?: string;
}

/**
 * The ContextSpace logo's open C, cut into one arc per milestone. Finished arcs
 * take the logo's gradient, a gold sun marks the current one, a reopened arc is
 * rose and hatched, and arcs still ahead stay dim. The geometry is in
 * features/progress/ringGeometry; the colours are the --ring-* and --state-*
 * tokens, so every palette gets a ring that reads on its own surfaces.
 */
function ContextRing({ milestones, size = 24, currentIndex, label, className, ...props }: ContextRingProps) {
  const ring = buildRing(milestones, { size, currentIndex });
  // With nothing planned the ring is one dim arc, so the logo's shape is still there.
  const arcs = ring.arcs.length ? ring.arcs : buildRing([{ state: "upcoming" }], { size }).arcs;
  return (
    <svg
      aria-label={label ?? describeRing(milestones)}
      className={cn("context-ring shrink-0", className)}
      data-slot="context-ring"
      height={size}
      role="img"
      viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
      width={size}
      {...props}
    >
      {arcs.map((arc) => (
        <g data-kind={ring.arcs.length ? arc.kind : "ahead"} key={arc.index}>
          <title>{ring.arcs.length ? arc.label : "No milestones planned"}</title>
          {arc.kind === "done" ? (
            <path className={`ring-arc ring-tone-${arc.tone}`} d={arc.d} />
          ) : (
            <path className="ring-arc ring-ahead" d={arc.d} />
          )}
          {arc.kind === "partial" && <path className={`ring-arc ring-tone-${arc.tone}`} d={arc.d} pathLength={100} strokeDasharray={`${(arc.litFraction ?? 0) * 100} 100`} />}
          {arc.kind === "active" && <path className={`ring-arc ring-active ring-tone-${arc.tone}`} d={arc.d} />}
          {arc.kind === "reopened" && <path className="ring-arc ring-reopened" d={arc.d} pathLength={100} />}
          {arc.kind === "blocked" && <path className="ring-arc ring-blocked" d={arc.d} pathLength={100} />}
        </g>
      ))}
      {ring.sun && <circle className="ring-sun" cx={ring.sun.cx} cy={ring.sun.cy} r={size < 40 ? 15 : 12} />}
    </svg>
  );
}

export { ContextRing };
export type { ContextRingProps };
