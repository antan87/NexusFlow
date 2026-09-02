import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export function assertPathWithin(rootDir: string, targetPath: string): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path "${targetPath}" is outside the allowed root.`);
  }
  return target;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

/**
 * Rejects symlink/junction components below a trusted root. Missing trailing
 * components are allowed because callers may create them after this check.
 */
export async function assertNoLinkedPathComponents(rootDir: string, targetPath: string): Promise<void> {
  const root = path.resolve(rootDir);
  const target = assertPathWithin(root, targetPath);
  const canonicalRoot = await fs.realpath(root);
  const relative = path.relative(root, target);
  if (!relative) return;

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Linked path components are not allowed in managed resource paths: ${current}`);
      }
      const canonicalCurrent = await fs.realpath(current);
      assertPathWithin(canonicalRoot, canonicalCurrent);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
  }
}

export async function assertRegularFile(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Expected a regular file: ${filePath}`);
  }
}

export async function assertPathIsNotLink(targetPath: string): Promise<void> {
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`Linked managed roots are not allowed: ${targetPath}`);
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
}

export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  beforeCommit?: () => Promise<void>,
): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, data);
    await beforeCommit?.();
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
