import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IconButton } from './icon-button';

const render = (props: Partial<Parameters<typeof IconButton>[0]> = {}) =>
  renderToStaticMarkup(createElement(IconButton, { label: 'Dismiss', icon: createElement('svg', { 'data-icon': 'x' }), ...props }));

describe('IconButton', () => {
  it('is a button named by its label, holding only the icon', () => {
    const html = render();
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('type="button"');
    expect(html).toContain('data-icon="x"');
    // The words are the name and the tooltip, not text on the button.
    expect(html).not.toMatch(/>Dismiss</);
  });

  it('is a square ghost button by default, and takes the larger size and the outline when asked', () => {
    expect(render()).toContain('size-6');
    expect(render()).toMatch(/border-transparent/);
    expect(render({ size: 'sm' })).toContain('size-7');
    expect(render({ variant: 'outline' })).toContain('border-border/80');
  });

  it('passes the usual button behaviour through', () => {
    const html = render({ disabled: true, className: 'extra-class' });
    expect(html).toMatch(/disabled=""/);
    expect(html).toContain('extra-class');
  });

  it('can announce what it is pressed for, like any button', () => {
    expect(render({ 'aria-pressed': true })).toContain('aria-pressed="true"');
  });
});
