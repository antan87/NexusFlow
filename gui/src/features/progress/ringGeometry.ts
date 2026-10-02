/**
 * Geometry for the Context Ring: the ContextSpace logo's open C cut into one arc
 * per milestone. Pure, so it can be tested without a DOM. The component only
 * turns these arcs into SVG.
 *
 * The C is open to the east and spans 310 degrees. Arcs run counterclockwise
 * from the top right over the top, down the left and round to the bottom right,
 * the way a C is drawn, so the first milestone sits where the logo's gold starts.
 */

export type RingMilestoneState = 'done' | 'in_progress' | 'reopened' | 'blocked' | 'upcoming';

export interface RingMilestone {
  state: RingMilestoneState;
  /** Used for the hover title and the accessible description. */
  title?: string;
  /**
   * How far through an in-progress milestone, from 0 to 1. Leave it out when
   * the extent is unknown: the arc is then drawn as active, never as a made-up fraction.
   */
  progress?: number;
}

/** How an arc is drawn. */
export type RingArcKind = 'done' | 'partial' | 'active' | 'reopened' | 'blocked' | 'ahead';

export interface RingArc {
  index: number;
  kind: RingArcKind;
  /** SVG path for the arc along the ring's centre line. */
  d: string;
  /** Position along the logo's gradient, 0 (first colour) to 6 (last colour). */
  tone: number;
  /** For `partial`: the share of the arc that is lit, 0 to 1. */
  litFraction?: number;
  label: string;
}

export interface RingSun {
  index: number;
  cx: number;
  cy: number;
}

export interface RingGeometry {
  arcs: RingArc[];
  /** The "you are here" marker, present only while a milestone is active. */
  sun?: RingSun;
}

export const RING_VIEWBOX = 200;
export const RING_STROKE = 40;
export const RING_RADIUS = 66;
export const RING_TONES = 7;
const CENTRE = RING_VIEWBOX / 2;
/** Half of the logo's opening, in degrees. */
const OPEN_HALF_ANGLE = 25;
const TOTAL_SPAN = 360 - 2 * OPEN_HALF_ANGLE;
const SMALL_GAP = 9;
const LARGE_GAP = 5;
/** Below this pixel size the gaps are wider so neighbouring arcs stay apart. */
const SMALL_SIZE = 40;
/** No arc is drawn narrower than this, however many milestones there are. */
const MIN_SPAN = 4;

function point(angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return { x: CENTRE + RING_RADIUS * Math.cos(radians), y: CENTRE + RING_RADIUS * Math.sin(radians) };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A counterclockwise arc between two angles that decrease as they go round. */
function arcPath(from: number, to: number): string {
  const start = point(from);
  const end = point(to);
  const large = Math.abs(from - to) > 180 ? 1 : 0;
  return `M${round(start.x)} ${round(start.y)}A${RING_RADIUS} ${RING_RADIUS} 0 ${large} 0 ${round(end.x)} ${round(end.y)}`;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function kindOf(milestone: RingMilestone): RingArcKind {
  switch (milestone.state) {
    case 'done': return 'done';
    case 'reopened': return 'reopened';
    case 'blocked': return 'blocked';
    case 'in_progress': return typeof milestone.progress === 'number' && Number.isFinite(milestone.progress) ? 'partial' : 'active';
    default: return 'ahead';
  }
}

const STATE_WORDS: Record<RingMilestoneState, string> = {
  done: 'done', in_progress: 'in progress', reopened: 'reopened', blocked: 'blocked', upcoming: 'not started',
};

/**
 * Builds the arcs for a list of milestones, in plan order. `currentIndex` picks
 * the milestone that carries the "you are here" marker; without it the marker
 * goes on the last in-progress milestone, or else the last reopened one.
 */
export function buildRing(
  milestones: readonly RingMilestone[],
  options: { size?: number; currentIndex?: number } = {},
): RingGeometry {
  const count = milestones.length;
  if (count === 0) return { arcs: [] };
  const preferredGap = (options.size ?? 24) < SMALL_SIZE ? SMALL_GAP : LARGE_GAP;
  // Many milestones squeeze the gaps first, so arcs never shrink below MIN_SPAN.
  const gap = count === 1 ? 0 : Math.min(preferredGap, Math.max(0, (TOTAL_SPAN - count * MIN_SPAN) / (count - 1)));
  const span = (TOTAL_SPAN - gap * (count - 1)) / count;

  const arcs = milestones.map((milestone, index): RingArc => {
    const from = -OPEN_HALF_ANGLE - index * (span + gap);
    const kind = kindOf(milestone);
    return {
      index,
      kind,
      d: arcPath(from, from - span),
      tone: count === 1 ? 3 : Math.round((index / (count - 1)) * (RING_TONES - 1)),
      ...(kind === 'partial' ? { litFraction: clamp01(milestone.progress!) } : {}),
      label: `${milestone.title ?? `Milestone ${index + 1}`}: ${STATE_WORDS[milestone.state]}`,
    };
  });

  const active = (index: number) => milestones[index]?.state === 'in_progress' || milestones[index]?.state === 'reopened';
  let sunIndex = options.currentIndex !== undefined && active(options.currentIndex) ? options.currentIndex : undefined;
  if (sunIndex === undefined && options.currentIndex === undefined) {
    sunIndex = milestones.map((m) => m.state).lastIndexOf('in_progress');
    if (sunIndex < 0) sunIndex = milestones.map((m) => m.state).lastIndexOf('reopened');
    if (sunIndex < 0) sunIndex = undefined;
  }
  if (sunIndex === undefined) return { arcs };

  const arc = arcs[sunIndex]!;
  const from = -OPEN_HALF_ANGLE - sunIndex * (span + gap);
  const along = arc.kind === 'partial' ? arc.litFraction! : 0.5;
  const sun = point(from - span * along);
  return { arcs, sun: { index: sunIndex, cx: round(sun.x), cy: round(sun.y) } };
}

/** A sentence for screen readers: the counts that matter, with zero counts left out. */
export function describeRing(milestones: readonly RingMilestone[]): string {
  if (milestones.length === 0) return 'No milestones planned';
  const count = (state: RingMilestoneState) => milestones.filter((m) => m.state === state).length;
  const parts = [`${count('done')} of ${milestones.length} milestones done`];
  for (const state of ['reopened', 'in_progress', 'blocked'] as const) {
    if (count(state)) parts.push(`${count(state)} ${STATE_WORDS[state]}`);
  }
  return parts.join(', ');
}
