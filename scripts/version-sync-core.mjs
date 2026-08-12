const VERSION_RE = /("version"\s*:\s*")([^"]*)(")/;

/** Synchronize a nested manifest or lockfile without relying on key order. */
export function syncVersionContents(contents, relPath, version) {
  if (!relPath.endsWith('package-lock.json')) {
    return contents.replace(VERSION_RE, `$1${version}$3`);
  }

  // npm lockfiles repeat the project version in packages[""]. Update both
  // fields structurally instead of depending on their textual position.
  const lock = JSON.parse(contents);
  if (!lock.packages?.['']) {
    throw new Error(`sync-version: no packages[""] entry found in ${relPath}.`);
  }
  lock.version = version;
  lock.packages[''].version = version;

  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = contents.endsWith('\n') ? newline : '';
  return `${JSON.stringify(lock, null, 2).replaceAll('\n', newline)}${trailingNewline}`;
}
