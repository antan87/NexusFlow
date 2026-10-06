import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceCodePanel } from './WorkspaceCodePanel.js';

describe('WorkspaceCodePanel Toolbar Actions', () => {
  it('renders Expand All and Collapse All toolbar buttons with accessible labels', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceCodePanel, {
        workspace: 'test-ws',
        active: true,
      })
    );

    // Verify header toolbar contains Expand All and Collapse All buttons
    expect(html).toContain('aria-label="Expand All"');
    expect(html).toContain('title="Expand All"');
    expect(html).toContain('aria-label="Collapse All"');
    expect(html).toContain('title="Collapse All"');

    // Verify mode toggle buttons
    expect(html).toContain('>Changes</button>');
    expect(html).toContain('>Files</button>');

    // Verify sidebar toggle button
    expect(html).toContain('aria-label="Hide file tree sidebar"');
  });

  it('renders close button when onClose handler is provided', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceCodePanel, {
        workspace: 'test-ws',
        active: true,
        onClose: () => {},
      })
    );

    expect(html).toContain('title="Close code panel"');
  });
});
