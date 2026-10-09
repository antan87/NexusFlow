import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RingMilestone } from '../../features/progress/ringGeometry';
import { ContextRing, type ContextRingProps } from './context-ring';

const render = (milestones: RingMilestone[], props: Partial<ContextRingProps> = {}) =>
  renderToStaticMarkup(createElement(ContextRing, { milestones, ...props }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('ContextRing', () => {
  it('is one labelled image sized as asked, in the logo\'s 200 unit box', () => {
    const html = render([{ state: 'done' }, { state: 'upcoming' }], { size: 28 });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="1 of 2 milestones done"');
    expect(html).toContain('width="28"');
    expect(html).toContain('height="28"');
    expect(html).toContain('viewBox="0 0 200 200"');
    expect(html).toContain('class="context-ring shrink-0"');
  });

  it('colours finished arcs along the logo gradient and leaves arcs ahead dim', () => {
    const html = render([{ state: 'done' }, { state: 'done' }, { state: 'upcoming' }]);
    expect(html).toMatch(/ring-tone-0/);
    expect(html).toMatch(/ring-tone-3/);
    expect(count(html, 'ring-ahead')).toBe(1);
  });

  it('draws a reopened arc hatched over a dim base, and a blocked arc differently', () => {
    const html = render([{ state: 'reopened', title: 'Plan' }, { state: 'blocked', title: 'Ship' }]);
    expect(html).toContain('ring-reopened');
    expect(html).toContain('ring-blocked');
    expect(count(html, 'ring-ahead')).toBe(2);
    expect(html).toContain('aria-label="0 of 2 milestones done, 1 reopened, 1 blocked"');
  });

  it('shows a partial arc by its real fraction, and an active arc without inventing one', () => {
    const partial = render([{ state: 'in_progress', progress: 0.4 }]);
    expect(partial).toContain('stroke-dasharray="40 100"');
    expect(partial).toContain('pathLength="100"');
    const active = render([{ state: 'in_progress' }]);
    expect(active).toContain('ring-active');
    expect(active).not.toContain('stroke-dasharray');
  });

  it('puts the sun only while something is active, larger on a small ring so it still shows', () => {
    expect(render([{ state: 'in_progress' }], { size: 18 })).toMatch(/<circle class="ring-sun"[^>]* r="15"/);
    expect(render([{ state: 'in_progress' }], { size: 64 })).toMatch(/<circle class="ring-sun"[^>]* r="12"/);
    expect(render([{ state: 'done' }, { state: 'upcoming' }])).not.toContain('ring-sun');
  });

  it('keeps the logo\'s shape with one dim arc, and says so, when nothing is planned', () => {
    const html = render([]);
    expect(html).toContain('aria-label="No milestones planned"');
    expect(count(html, '<path')).toBe(1);
    expect(html).toContain('ring-ahead');
    expect(html).toContain('<title>No milestones planned</title>');
    expect(html).not.toContain('ring-sun');
  });

  it('gives every arc a hover title with its milestone and state', () => {
    const html = render([{ state: 'done', title: 'Brief' }, { state: 'reopened', title: 'Plan' }]);
    expect(html).toContain('<title>Brief: done</title>');
    expect(html).toContain('<title>Plan: reopened</title>');
  });

  it('escapes a milestone title instead of injecting it as markup', () => {
    const html = render([{ state: 'done', title: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lets a caller replace the description, add a class and pass other attributes through', () => {
    const html = render([{ state: 'done' }], { label: 'Redo the GUI: 1 of 1 done', className: 'size-6', 'data-testid': 'ring' } as Partial<ContextRingProps>);
    expect(html).toContain('aria-label="Redo the GUI: 1 of 1 done"');
    expect(html).toContain('context-ring shrink-0 size-6');
    expect(html).toContain('data-testid="ring"');
  });

  it('places the sun on the milestone the caller names', () => {
    const html = render([{ state: 'in_progress' }, { state: 'reopened' }, { state: 'in_progress' }], { currentIndex: 1 });
    expect(count(html, 'ring-sun')).toBe(1);
  });
});
