import { describe, expect, it } from 'vitest';
import { removeGeneratedProgressChecklist } from './index.js';

describe('generated progress migration', () => {
  it('removes only generated unchecked rows and retains authored progress', () => {
    const content = [
      '# Knowledge', '',
      '## Implementation Progress', '',
      '- [ ] api — changes implemented and tested',
      '- [x] Auth migration verified manually', '',
      '## Known Gotchas', '', '- keep me', '',
    ].join('\n');
    const migrated = removeGeneratedProgressChecklist(content, ['api']);
    expect(migrated).not.toContain('api — changes implemented and tested');
    expect(migrated).toContain('Auth migration verified manually');
    expect(migrated).toContain('## Known Gotchas');
  });

  it('removes the empty section when it contained only generated rows', () => {
    const content = '# Knowledge\n\n## Implementation Progress\n\n- [ ] api — changes implemented and tested\n';
    expect(removeGeneratedProgressChecklist(content, ['api'])).toBe('# Knowledge\n');
  });
});
