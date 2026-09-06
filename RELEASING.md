# Releasing NexusFlow

NexusFlow ships three artifacts from this one repository, all in **lockstep** on a
single version:

| Channel | Artifact | Published to |
|---|---|---|
| npm | `@mrpatronz/nexusflow` (CLI + server + bundled GUI) | npm registry |
| VS Code extension | `nexusflow.nexusflow-vscode` | VS Code Marketplace |
| Desktop | `NexusFlowSetup.exe` (Windows NSIS), `NexusFlow-<version>.AppImage` (Linux), plus `latest.yml`/`latest-linux.yml` and `.sha256` sidecars | GitHub Releases |

## The one rule: version lives in the root `package.json`

The root [`package.json`](./package.json) `version` is the **single source of truth**.
[`scripts/sync-version.mjs`](./scripts/sync-version.mjs) propagates it to every other
version-bearing file:

- `extension/package.json`
- `desktop/package.json`
- `gui/package.json`

The desktop installer has no separate version target: electron-builder reads it
from `desktop/package.json` (already synced above).

CI runs `node scripts/sync-version.mjs --check` and **fails on any drift**.

## How to cut a release

The release workflow is dispatched explicitly from the protected default branch.
Do not push a hand-created tag: the workflow guard creates the immutable tag only
after it has verified the requested version and synchronized source files.

Start from a clean working tree. From a feature branch, bump and synchronize the
version without creating a local tag, then open and merge a reviewed PR through
the protected `main` branch:

```bash
npm version minor --no-git-tag-version   # or patch / major
git status                               # review the synchronized version files
git commit -m "chore: prepare release"   # version hook already staged the synced files
git push origin HEAD
```

After the PR is merged, dispatch the release using the exact version in the merged
`package.json` (the dispatch is intentionally separate from the source PR):

```bash
VERSION=$(node -p "require('./package.json').version")
gh api "repos/antan87/NexusFlow/dispatches" \
  -f event_type=release \
  -F "client_payload[version]=$VERSION"
```

The `npm version` command runs the `version` lifecycle script
(`sync-version.mjs && git add -A`), so all channel manifests are reviewed in the
same PR. The repository-dispatch event loads the workflow from protected `main`;
it does not rely on a tag push triggering workflow code from an unreviewed ref.

The [`release.yml`](./.github/workflows/release.yml) workflow then:

1. **`guard`** — verifies the dispatch came from protected `main`, checks the requested
   version against `package.json`, runs the sync check, and creates the immutable tag.
2. **`npm` / `vscode` / `desktop`** run in parallel. npm and Marketplace skip versions
   that are already published; desktop rebuilds its installers and metadata on each
   run. npm uses trusted OIDC publishing; the Marketplace job is enabled only when
   the repository variable `VSCODE_PUBLISHING_ENABLED=true` and Azure OIDC credentials
   are present.
3. **`github-release`** — creates **one** GitHub Release for the tag with generated
   notes and attaches both desktop installers, their checksum sidecars, and the
   electron-updater metadata (`latest.yml` and `latest-linux.yml`).

## Version baseline

Lockstep versions must always move forward from the versions already published to
npm, the Marketplace, and GitHub Releases. Check the live channel versions before
choosing a bump; never lower the root `package.json` version and never bypass the
protected PR plus dispatch guard with a manual tag.

## Prereleases

Tags with a semver prerelease suffix (e.g. `v1.2.0-rc.1`):

- publish to npm under the `next` dist-tag (keeps `latest` stable),
- mark the GitHub Release as a prerelease,
- **skip** the Marketplace (it doesn't support semver prerelease suffixes).

Use these to rehearse the pipeline end-to-end before a real release.

## Required credentials

- npm trusted publishing is configured through the package/repository OIDC trust;
  the workflow requests `id-token: write` and does not use an `NPM_TOKEN` secret.
- `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` — Azure OIDC for `vsce publish`, used only
  when the repository variable `VSCODE_PUBLISHING_ENABLED=true`.

## Local dry-run checks (no publishing)

```bash
node scripts/sync-version.mjs --check   # all channels agree with root
npm run build && npm pack --dry-run     # inspect the generated package contents
(cd extension && npx vsce package)      # produces a .vsix at the synced version

# On Windows, electron-builder produces the NSIS installer; on Linux it produces
# the AppImage. Both builds also emit electron-updater metadata:
npm run build --prefix desktop
```

## Explicit desktop bootstrap (mutating)

After the package and desktop release are published, bootstrap the matching native
desktop release from the installed CLI:

```bash
nexusflow desktop install
```
