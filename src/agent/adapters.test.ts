import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProviderRegistry } from './ProviderRegistry.js';
import { cachedStatus } from './adapters.js';

describe('cachedStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects once for repeated reads inside the window', () => {
    // isConfigured() and getStatusMessage() are separate calls on the same
    // provider, so listing statuses ran every detector twice — and each walks
    // PATH with a statSync per directory per PATHEXT entry, then reads a
    // credentials file.
    const detect = vi.fn(() => ({ usable: true }));
    const read = cachedStatus(detect);

    read();
    read();
    read();

    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('returns the same value each time it is cached', () => {
    const detect = vi.fn(() => ({ usable: false, message: 'not signed in' }));
    const read = cachedStatus(detect);

    expect(read()).toEqual({ usable: false, message: 'not signed in' });
    expect(read()).toEqual({ usable: false, message: 'not signed in' });
  });

  it('re-detects once the window has passed, so an install is noticed', () => {
    // A permanent cache would need a restart to see a newly installed CLI.
    vi.useFakeTimers();
    const detect = vi.fn(() => ({ usable: false }));
    const read = cachedStatus(detect, 5_000);

    read();
    vi.advanceTimersByTime(4_999);
    read();
    expect(detect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    read();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('caches an undefined result too', () => {
    // Freshness is a flag, not a test of the value: keying on
    // `value === undefined` would make a detector that legitimately returns
    // undefined re-run on every read, defeating the whole point.
    const detect = vi.fn(() => undefined);
    const read = cachedStatus(detect);

    read();
    read();

    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('re-detects immediately after an explicit invalidation', () => {
    const detect = vi.fn()
      .mockReturnValueOnce({ usable: false })
      .mockReturnValueOnce({ usable: true });
    const read = cachedStatus(detect);

    expect(read()).toEqual({ usable: false });
    read.invalidate();
    expect(read()).toEqual({ usable: true });
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('ages the cache from completion of a slow detector', () => {
    vi.useFakeTimers();
    const detect = vi.fn(() => {
      vi.advanceTimersByTime(5_000);
      return { usable: false };
    });
    const read = cachedStatus(detect, 5_000);

    read();
    read();
    read();

    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('registers claude-sdk with provider-assigned sessionIdentity capability', () => {
    const claudeSdk = ProviderRegistry.getProvider('claude-sdk');
    expect(claudeSdk).toBeDefined();
    expect(claudeSdk?.capabilities.sessionIdentity).toBe('provider-assigned');
    expect(claudeSdk?.capabilities.transport).toBe('sdk');
  });
});
