import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as net from 'node:net';
import { findAvailablePort, uiCommand } from './ui.js';
import * as serverModule from '../server.js';

vi.mock('../server.js', () => ({
  startServer: vi.fn().mockResolvedValue({ port: 3001, server: {} }),
}));

describe('uiCommand port selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds an available port when requested port is available', async () => {
    const port = await findAvailablePort(38900);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThanOrEqual(38900);
  });

  it('selects the next available port if requested port is in use', async () => {
    // Start a temporary dummy TCP server on a dynamic port
    const dummyServer = net.createServer();
    await new Promise<void>((resolve) => {
      dummyServer.listen(0, 'localhost', () => resolve());
    });

    const address = dummyServer.address() as net.AddressInfo;
    const occupiedPort = address.port;

    try {
      // Find next available port starting from occupiedPort
      const freePort = await findAvailablePort(occupiedPort);
      expect(freePort).not.toBe(occupiedPort);
      expect(freePort).toBeGreaterThan(occupiedPort);
    } finally {
      await new Promise<void>((resolve) => {
        dummyServer.close(() => resolve());
      });
    }
  });

  it('uiCommand respects strictPort mode when port is occupied', async () => {
    const dummyServer = net.createServer();
    await new Promise<void>((resolve) => {
      dummyServer.listen(0, 'localhost', () => resolve());
    });

    const address = dummyServer.address() as net.AddressInfo;
    const occupiedPort = address.port;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await uiCommand({ port: String(occupiedPort), strictPort: true });
      expect(serverModule.startServer).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already in use'));
    } finally {
      consoleSpy.mockRestore();
      await new Promise<void>((resolve) => {
        dummyServer.close(() => resolve());
      });
    }
  });
});
