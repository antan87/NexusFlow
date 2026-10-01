import * as net from 'node:net';

/**
 * Whether something accepts connections on a local port. Probes the IPv4 and
 * IPv6 loopback addresses together, each with a timeout, because dev servers
 * bind to either one depending on how `localhost` resolves.
 */
export async function isLocalPortListening(port: number, timeoutMs = 500): Promise<boolean> {
  const probe = (host: string) => new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host });
    const done = (listening: boolean) => { socket.destroy(); resolve(listening); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
  const [v4, v6] = await Promise.all([probe('127.0.0.1'), probe('::1')]);
  return v4 || v6;
}
