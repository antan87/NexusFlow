import { describe, expect, it } from 'vitest';
import { exactLocalOrigin, isExactLocalOrigin, isTrustedIpcEvent } from './security.js';

describe('desktop renderer security helpers', () => {
  it('accepts only the exact localhost origin and assigned port', () => {
    expect(exactLocalOrigin(43123)).toBe('http://localhost:43123');
    expect(isExactLocalOrigin('http://localhost:43123/', 43123)).toBe(true);
    expect(isExactLocalOrigin('http://localhost:431230/', 43123)).toBe(false);
    expect(isExactLocalOrigin('http://localhost:43123.evil.example/', 43123)).toBe(false);
    expect(isExactLocalOrigin('http://localhost:43124/', 43123)).toBe(false);
  });

  it('rejects userinfo, data URLs, non-http schemes, and invalid ports', () => {
    expect(isExactLocalOrigin('http://user@localhost:43123/', 43123)).toBe(false);
    expect(isExactLocalOrigin('http://localhost:43123@evil.example/', 43123)).toBe(false);
    expect(isExactLocalOrigin('data:text/html,<h1>no</h1>', 43123)).toBe(false);
    expect(isExactLocalOrigin('https://localhost:43123/', 43123)).toBe(false);
    expect(isExactLocalOrigin('http://localhost:0/', 0)).toBe(false);
  });

  it('requires exact webContents, main frame, and main-frame origin for IPC', () => {
    const mainFrame = { url: 'http://localhost:43123/dashboard' };
    const webContents = { mainFrame };
    const window = { webContents };
    expect(isTrustedIpcEvent({ sender: webContents, senderFrame: mainFrame }, window, 43123)).toBe(true);
    expect(isTrustedIpcEvent({ sender: {}, senderFrame: mainFrame }, window, 43123)).toBe(false);
    expect(isTrustedIpcEvent({ sender: webContents, senderFrame: { url: mainFrame.url } }, window, 43123)).toBe(false);
    expect(isTrustedIpcEvent({ sender: webContents, senderFrame: { url: 'data:text/html,evil' } }, window, 43123)).toBe(false);
    expect(isTrustedIpcEvent({ sender: webContents, senderFrame: { url: 'http://localhost:431230/' } }, window, 43123)).toBe(false);
  });
});
