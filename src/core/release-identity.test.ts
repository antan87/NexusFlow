import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_CONFIG } from './brand-config.js';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('published package identity', () => {
  it('uses the package actually released for bootstrap and update lookup', () => {
    expect(BRAND_CONFIG.engine.npmPackage).toBe(packageJson.name);
    expect(BRAND_CONFIG.mcp.packageName).toBe(packageJson.name);
    expect(packageJson.bin[BRAND_CONFIG.identity.cliName]).toBe('dist/index.js');
  });
});
