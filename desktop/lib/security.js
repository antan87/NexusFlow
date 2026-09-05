/**
 * Pure renderer-origin and IPC-sender checks used by the Electron main
 * process. Keep these independent from Electron so hostile URL cases can be
 * tested without launching a window.
 */

export function exactLocalOrigin(port) {
  return `http://localhost:${String(port)}`;
}

export function isExactLocalOrigin(candidate, port) {
  if (!Number.isInteger(Number(port)) || Number(port) <= 0 || Number(port) > 65535) return false;
  try {
    const url = new URL(String(candidate));
    if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.username || url.password) return false;
    return url.origin === exactLocalOrigin(port);
  } catch {
    return false;
  }
}

export function isTrustedIpcEvent(event, mainWindow, assignedPort) {
  const webContents = mainWindow?.webContents;
  if (!webContents || !event || event.sender !== webContents) return false;
  if (!event.senderFrame || event.senderFrame !== webContents.mainFrame) return false;
  return isExactLocalOrigin(event.senderFrame.url, assignedPort);
}
