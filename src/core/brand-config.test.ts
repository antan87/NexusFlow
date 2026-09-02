import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {
  BRAND_CONFIG,
  resolveFirstEnv,
  resolveBrandHomeDir,
  resolveWorkspaceFilePath,
  resolveWorkspaceFilePathSync,
  getPm2ProcessPrefix,
  getDesktopReadyTokens,
  getDesktopReadyPortRegex,
  getFreshnessSentinelRegex,
  createFreshnessMarker,
} from './brand-config.js';

describe('Brand Configuration System', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defines canonical brand identities and CLI aliases', () => {
    expect(BRAND_CONFIG.identity.name).toBe('ContextSpace');
    expect(BRAND_CONFIG.identity.cliName).toBe('ctxspace');
    expect(BRAND_CONFIG.identity.cliAliases).toContain('contextspace');
    expect(BRAND_CONFIG.identity.cliAliases).toContain('cs');
    expect(BRAND_CONFIG.identity.cliAliases).toContain('nexusflow');
  });

  it('defines file pairs with primary and legacy conventions', () => {
    expect(BRAND_CONFIG.files.manifest.primary).toBe('contextspace.json');
    expect(BRAND_CONFIG.files.manifest.legacy).toBe('nexusflow.json');
    expect(BRAND_CONFIG.files.lock.primary).toBe('contextspace.lock');
    expect(BRAND_CONFIG.files.lock.legacy).toBe('nexusflow.lock');
    expect(BRAND_CONFIG.files.knowledge.primary).toBe('contextspace-knowledge.md');
    expect(BRAND_CONFIG.files.knowledge.legacy).toBe('nexusflow-knowledge.md');
  });

  it('defines the canonical Tropical Sunset Hex-CW theme palette', () => {
    expect(BRAND_CONFIG.theme.primary).toBe('#F97316');
    expect(BRAND_CONFIG.theme.sunset.gold).toBe('#FDE047');
    expect(BRAND_CONFIG.theme.sunset.coral).toBe('#FB923C');
    expect(BRAND_CONFIG.theme.sunset.hibiscus).toBe('#F43F5E');
    expect(BRAND_CONFIG.theme.sunset.indigo).toBe('#6366F1');
    expect(BRAND_CONFIG.theme.dark.background).toBe('#0A0812');
  });

  it('resolves first defined environment variable in priority order', () => {
    delete process.env.CONTEXTSPACE_HOME;
    delete process.env.NEXUSFLOW_HOME;

    expect(resolveFirstEnv(BRAND_CONFIG.env.home)).toBeUndefined();

    process.env.NEXUSFLOW_HOME = '/legacy/home';
    expect(resolveFirstEnv(BRAND_CONFIG.env.home)).toBe('/legacy/home');

    process.env.CONTEXTSPACE_HOME = '/primary/home';
    expect(resolveFirstEnv(BRAND_CONFIG.env.home)).toBe('/primary/home');
  });

  it('resolves brand home directory with env priority and fallback', () => {
    process.env.CONTEXTSPACE_HOME = '/custom/cs/home';
    expect(resolveBrandHomeDir()).toBe(path.resolve('/custom/cs/home'));
  });

  it('computes workspace-scoped PM2 prefix', () => {
    const ws = '/path/to/my-feature';
    const prefix = getPm2ProcessPrefix(ws);
    expect(prefix).toMatch(/^ctxspace-my-feature-[0-9a-f]{8}-$/);
  });

  it('generates desktop readiness handshake tokens and parser regex', () => {
    const tokens = getDesktopReadyTokens(4567);
    expect(tokens).toContain('CONTEXTSPACE_READY_PORT=4567');
    expect(tokens).toContain('NEXUSFLOW_READY_PORT=4567');

    const regex = getDesktopReadyPortRegex();
    expect('CONTEXTSPACE_READY_PORT=5000'.match(regex)?.[1]).toBe('5000');
    expect('NEXUSFLOW_READY_PORT=6000'.match(regex)?.[1]).toBe('6000');
  });

  it('creates and matches freshness sentinel markers', () => {
    const marker = createFreshnessMarker('abc1234');
    expect(marker).toContain('<!-- CONTEXTSPACE:FRESHNESS:START -->');
    expect(marker).toContain('<!-- CONTEXTSPACE:FRESHNESS:END -->');
    expect(marker).toContain('ContextSpace@abc1234');

    const regex = getFreshnessSentinelRegex();
    expect(regex.test(marker)).toBe(true);

    const legacyMarker = `<!-- NEXUSFLOW:FRESHNESS:START -->\n> **NexusFlow snapshot:** NexusFlow@abc1234\n<!-- NEXUSFLOW:FRESHNESS:END -->`;
    expect(regex.test(legacyMarker)).toBe(true);
  });

  it('resolves workspace files asynchronously with fallback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-test-'));
    try {
      // Non-existent file defaults to primary path
      const missing = await resolveWorkspaceFilePath(tempDir, 'manifest');
      expect(missing.path).toBe(path.join(tempDir, 'contextspace.json'));
      expect(missing.exists).toBe(false);

      // Legacy file exists
      await fs.writeFile(path.join(tempDir, 'nexusflow.json'), '{}');
      const legacy = await resolveWorkspaceFilePath(tempDir, 'manifest');
      expect(legacy.path).toBe(path.join(tempDir, 'nexusflow.json'));
      expect(legacy.isLegacy).toBe(true);
      expect(legacy.exists).toBe(true);

      // Primary file exists (takes precedence)
      await fs.writeFile(path.join(tempDir, 'contextspace.json'), '{}');
      const primary = await resolveWorkspaceFilePath(tempDir, 'manifest');
      expect(primary.path).toBe(path.join(tempDir, 'contextspace.json'));
      expect(primary.isLegacy).toBe(false);
      expect(primary.exists).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves workspace files synchronously with fallback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-test-sync-'));
    try {
      await fs.writeFile(path.join(tempDir, 'nexusflow.lock'), '{}');
      const legacy = resolveWorkspaceFilePathSync(tempDir, 'lock');
      expect(legacy.path).toBe(path.join(tempDir, 'nexusflow.lock'));
      expect(legacy.isLegacy).toBe(true);

      await fs.writeFile(path.join(tempDir, 'contextspace.lock'), '{}');
      const primary = resolveWorkspaceFilePathSync(tempDir, 'lock');
      expect(primary.path).toBe(path.join(tempDir, 'contextspace.lock'));
      expect(primary.isLegacy).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
