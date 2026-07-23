// electron-builder afterPack hook. Fails the build if the bundled backend is
// missing its manifest or runtime dependencies in the packed output, so an
// installer whose backend can't start (ERR_MODULE_NOT_FOUND at launch — as
// shipped once when resources/backend arrived without node_modules) can never
// be produced silently again.
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {{ appOutDir: string, packager: any, electronPlatformName: string }} context
 */
export default async function verifyBackend(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  // Platform-correct resources dir. electron-builder exposes a helper; fall
  // back to the known layout if that internal API ever changes.
  let resourcesDir;
  if (typeof packager?.getResourcesDir === 'function') {
    resourcesDir = packager.getResourcesDir(appOutDir);
  } else if (electronPlatformName === 'darwin') {
    const productFilename = packager?.appInfo?.productFilename ?? 'NexusFlow';
    resourcesDir = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const backendDir = path.join(resourcesDir, 'backend');
  const required = [
    'package.json',
    path.join('dist', 'desktop-server.js'),
    path.join('node_modules', 'hono'),
    path.join('node_modules', '@hono', 'node-server'),
  ];
  const missing = required.filter((rel) => !existsSync(path.join(backendDir, rel)));

  if (missing.length > 0) {
    throw new Error(
      `[verify-backend] packaged backend is incomplete at ${backendDir}\n` +
        `  missing: ${missing.join(', ')}\n` +
        '  The app would launch with a dead backend. Check desktop/scripts/prepare-backend.mjs ' +
        'and build.extraResources.',
    );
  }
  console.log(`[verify-backend] OK — bundled backend complete at ${backendDir}`);
}
