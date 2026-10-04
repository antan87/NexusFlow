import { describe, expect, it } from 'vitest';

import { RING_TONES, buildRing, describeRing, type RingMilestone } from './ringGeometry.js';

const ms = (...states: Array<RingMilestone['state']>): RingMilestone[] => states.map((state) => ({ state }));

/** Reads the two angles back out of an arc's end points. */
function angles(d: string): { from: number; to: number } {
  const m = /^M(-?[\d.]+) (-?[\d.]+)A66 66 0 [01] 0 (-?[\d.]+) (-?[\d.]+)$/.exec(d);
  if (!m) throw new Error(`unexpected path ${d}`);
  const angle = (x: string, y: string) => (Math.atan2(Number(y) - 100, Number(x) - 100) * 180) / Math.PI;
  return { from: angle(m[1]!, m[2]!), to: angle(m[3]!, m[4]!) };
}

describe('buildRing', () => {
  it('has no arcs and no sun for no milestones', () => {
    expect(buildRing([])).toEqual({ arcs: [] });
  });

  it('starts the first arc at the top right of the logo, 25 degrees above east', () => {
    const [first] = buildRing(ms('done', 'upcoming')).arcs;
    expect(first!.d.startsWith('M159.82 72.11A66 66 0 ')).toBe(true);
    expect(angles(first!.d).from).toBeCloseTo(-25, 1);
  });

  it('runs the arcs counterclockwise inside the logo\'s 310 degree span, never into its opening', () => {
    const { arcs } = buildRing(ms('done', 'done', 'in_progress', 'upcoming', 'upcoming'), { size: 120 });
    const all = arcs.map((arc) => angles(arc.d));
    expect(all[0]!.from).toBeCloseTo(-25, 1);
    // The last arc ends 25 degrees below east, which is -335 going the long way round.
    expect(all.at(-1)!.to).toBeCloseTo(25, 0);
    for (const arc of all) expect(arc.to).not.toBeNull();
  });

  it('puts a gap of 5 degrees between arcs on a large ring and 9 on a small one', () => {
    const gapBetween = (size: number) => {
      const [a, b] = buildRing(ms('done', 'done', 'done'), { size }).arcs.map((arc) => angles(arc.d));
      // Angles wrap at 180, so compare modulo a full turn.
      return (((a!.to - b!.from) % 360) + 360) % 360;
    };
    expect(gapBetween(120)).toBeCloseTo(5, 1);
    expect(gapBetween(18)).toBeCloseTo(9, 1);
  });

  it('draws a single milestone as one large arc with the middle colour', () => {
    const [only] = buildRing(ms('done')).arcs;
    expect(only!.d).toMatch(/A66 66 0 1 0 /);
    expect(only!.tone).toBe(3);
  });

  it('spreads colour tones across the whole logo gradient, first to last', () => {
    const tones = buildRing(ms('done', 'done', 'done', 'done', 'done')).arcs.map((arc) => arc.tone);
    expect(tones[0]).toBe(0);
    expect(tones.at(-1)).toBe(RING_TONES - 1);
    expect([...tones].sort((a, b) => a - b)).toEqual(tones);
  });

  it('keeps every arc at least 4 degrees wide however many milestones there are, and never overlaps them', () => {
    const { arcs } = buildRing(Array.from({ length: 60 }, () => ({ state: 'upcoming' as const })), { size: 18 });
    expect(arcs).toHaveLength(60);
    // Distance travelled along the ring from its start at the top right, 0 to 310 degrees. This avoids the wrap at 180.
    // Rounded coordinates can land a hair before the start, which would read as 359.99, so those fold back to about 0.
    const along = (angle: number) => {
      const value = (((-25 - angle) % 360) + 360) % 360;
      return value > 340 ? value - 360 : value;
    };
    let previousEnd = -0.05;
    for (const arc of arcs) {
      const { from, to } = angles(arc.d);
      const start = along(from);
      const end = along(to);
      expect(start).toBeGreaterThanOrEqual(previousEnd - 0.05);
      expect(end - start).toBeGreaterThanOrEqual(3.9);
      previousEnd = end;
    }
    expect(previousEnd).toBeLessThanOrEqual(310.05);
  });

  it('maps each state to how it is drawn', () => {
    const kinds = buildRing([
      { state: 'done' }, { state: 'in_progress' }, { state: 'in_progress', progress: 0.4 },
      { state: 'reopened' }, { state: 'blocked' }, { state: 'upcoming' },
    ]).arcs.map((arc) => arc.kind);
    expect(kinds).toEqual(['done', 'active', 'partial', 'reopened', 'blocked', 'ahead']);
  });

  it('never invents progress: an in-progress arc with no fraction is active, and a bad fraction is clamped or ignored', () => {
    const arcs = buildRing([
      { state: 'in_progress' },
      { state: 'in_progress', progress: 7 },
      { state: 'in_progress', progress: -3 },
      { state: 'in_progress', progress: Number.NaN },
      { state: 'in_progress', progress: Number.POSITIVE_INFINITY },
    ]).arcs;
    expect(arcs.map((a) => a.kind)).toEqual(['active', 'partial', 'partial', 'active', 'active']);
    expect(arcs[1]!.litFraction).toBe(1);
    expect(arcs[2]!.litFraction).toBe(0);
  });

  it('labels each arc with its title and state, and falls back to a number', () => {
    const { arcs } = buildRing([{ state: 'reopened', title: 'Plan' }, { state: 'upcoming' }]);
    expect(arcs.map((a) => a.label)).toEqual(['Plan: reopened', 'Milestone 2: not started']);
  });

  describe('the "you are here" sun', () => {
    it('is absent when nothing is active', () => {
      expect(buildRing(ms('done', 'upcoming')).sun).toBeUndefined();
      expect(buildRing(ms('done', 'blocked')).sun).toBeUndefined();
    });

    it('goes on the last in-progress milestone by default', () => {
      expect(buildRing(ms('done', 'in_progress', 'in_progress', 'upcoming')).sun?.index).toBe(2);
    });

    it('falls back to the last reopened milestone when none is in progress', () => {
      expect(buildRing(ms('done', 'reopened', 'upcoming')).sun?.index).toBe(1);
    });

    it('goes where the caller says, if that milestone is active', () => {
      expect(buildRing(ms('in_progress', 'reopened', 'in_progress'), { currentIndex: 1 }).sun?.index).toBe(1);
    });

    it('is not placed on a finished or missing milestone, even if the caller asks', () => {
      expect(buildRing(ms('done', 'in_progress'), { currentIndex: 0 }).sun).toBeUndefined();
      expect(buildRing(ms('done', 'in_progress'), { currentIndex: 9 }).sun).toBeUndefined();
      expect(buildRing(ms('done', 'in_progress'), { currentIndex: -1 }).sun).toBeUndefined();
    });

    it('sits on the ring, at the lit edge of a partial arc and the middle of an active one', () => {
      const partial = buildRing([{ state: 'in_progress', progress: 0 }], { size: 120 });
      expect(Math.hypot(partial.sun!.cx - 100, partial.sun!.cy - 100)).toBeCloseTo(66, 0);
      // Zero progress puts it at the arc's start, which for the first arc is the logo's top right.
      expect(partial.sun!.cx).toBeCloseTo(159.82, 1);
      const active = buildRing([{ state: 'in_progress' }], { size: 120 });
      expect(Math.hypot(active.sun!.cx - 100, active.sun!.cy - 100)).toBeCloseTo(66, 0);
      expect(active.sun!.cx).not.toBeCloseTo(partial.sun!.cx, 0);
    });
  });
});

describe('describeRing', () => {
  it('says so when nothing is planned', () => {
    expect(describeRing([])).toBe('No milestones planned');
  });

  it('gives the done count and only the other counts that are not zero', () => {
    expect(describeRing(ms('done', 'done', 'reopened', 'in_progress', 'upcoming')))
      .toBe('2 of 5 milestones done, 1 reopened, 1 in progress');
    expect(describeRing(ms('done', 'done'))).toBe('2 of 2 milestones done');
    expect(describeRing(ms('upcoming', 'blocked'))).toBe('0 of 2 milestones done, 1 blocked');
  });
});
