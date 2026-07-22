import { describe, it, expect } from 'vitest';

import { isNewerVersion } from './update-check.js';

describe('isNewerVersion', () => {
  it('detects higher major/minor/patch', () => {
    expect(isNewerVersion('1.8.0', '2.0.0')).toBe(true);
    expect(isNewerVersion('1.8.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.8.0', '1.8.1')).toBe(true);
  });

  it('returns false when equal or older', () => {
    expect(isNewerVersion('1.8.0', '1.8.0')).toBe(false);
    expect(isNewerVersion('1.9.0', '1.8.0')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  it('tolerates a leading v and a prerelease/build suffix instead of returning NaN-false', () => {
    // Previously `.map(Number)` turned '0-rc' into NaN and reported no update.
    expect(isNewerVersion('1.8.0', 'v1.9.0')).toBe(true);
    expect(isNewerVersion('1.8.0', '1.9.0-rc.1')).toBe(true);
    expect(isNewerVersion('1.8.0-beta.2', '1.8.0-beta.3')).toBe(false); // same numeric core
  });

  it('treats a stable release as newer than a prerelease of the same core', () => {
    expect(isNewerVersion('1.8.0-rc.1', '1.8.0')).toBe(true);
    expect(isNewerVersion('1.8.0', '1.8.0-rc.1')).toBe(false);
  });
});
