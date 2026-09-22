import { lstat, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

/** node-pty 1.1.0 ships Darwin prebuild helpers without executable permissions.
 * Repair the installed helper before use (also before signing desktop packages).
 * https://github.com/microsoft/node-pty/issues/850
 */
export async function preparePtyHelper(platform = process.platform, moduleRoot?: string, arch = process.arch): Promise<void> {
  if (platform !== 'darwin') return;
  const root = moduleRoot ?? path.dirname(require.resolve('node-pty/package.json'));
  for (const dir of ['build/Release', 'build/Debug', `prebuilds/darwin-${arch}`]) {
    const helper = path.join(root, dir, 'spawn-helper');
    let stat;
    try { stat = await lstat(helper); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!stat.isFile()) throw new Error('Native terminal spawn helper must be a regular file.');
    if ((stat.mode & 0o111) !== 0o111) await chmod(helper, stat.mode | 0o111);
  }
}
