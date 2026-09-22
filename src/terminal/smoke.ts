/** Run with the SAME runtime that will host the packaged backend. No AI account needed. */
import { resolveLaunch } from './targets.js';
import { spawnNativePty, terminatePty } from './manager.js';

const launch = resolveLaunch('shell');
const child = await spawnNativePty(launch, process.cwd(), 80, 24);
const marker = 'CONTEXTSPACE_' + 'PTY_READY';
const command = process.platform === 'win32' ? `Write-Output ('CONTEXTSPACE_' + 'PTY_READY')\r` : `printf 'CONTEXTSPACE_%s\\n' PTY_READY\r`;
let text = '';
let success = false;
const deadline = setTimeout(() => { terminatePty(child); console.error('Native terminal smoke timed out.'); process.exit(1); }, 10_000);
child.onData(data => {
  text += data;
  if (!success && text.includes(marker)) {
    success = true;
    child.resize(100, 30);
    terminatePty(child);
  }
});
child.onExit(({ exitCode }) => {
  clearTimeout(deadline);
  if (!success) console.error(`Terminal exited before its output was verified (${exitCode}).`);
  else console.log(`Native terminal verified: ${process.platform}/${process.arch}, ${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node}`);
  // ConPTY workers can retain Node's event loop after the shell exits. This
  // one-shot probe has verified output, resize and exit; release its runtime.
  setTimeout(() => process.exit(success ? 0 : 1), 100);
});
child.write(command);
