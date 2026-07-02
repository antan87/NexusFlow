# Releasing NexusFlow

NexusFlow ships three artifacts from this one repository, all in **lockstep** on a
single version:

| Channel | Artifact | Published to |
|---|---|---|
| npm | `@mrpatronz/nexusflow` (CLI + server + bundled GUI) | npm registry |
| VS Code extension | `nexusflow.nexusflow-vscode` | VS Code Marketplace |
| Desktop | `NexusFlowSetup.exe` (Windows installer) | GitHub Releases |

## The one rule: version lives in the root `package.json`

The root [`package.json`](./package.json) `version` is the **single source of truth**.
[`scripts/sync-version.mjs`](./scripts/sync-version.mjs) propagates it to every other
version-bearing file:

- `extension/package.json`
- `desktop/package.json`
- `gui/package.json`
- `desktop/neutralino.config.json` (top-level `version` only — the Neutralino
  `binaryVersion`/`clientVersion` are the framework versions and are left alone)
- the installer's `AppVersion` is injected at build time via an ISCC `/DAppVersion`
  define, so `desktop/installer/nexusflow.iss` never carries a hardcoded version.

CI runs `node scripts/sync-version.mjs --check` and **fails on any drift**.

## How to cut a release

From a clean working tree on `main`:

```bash
npm version minor        # or patch / major — bumps root, runs sync-version, commits, tags vX.Y.Z
git push --follow-tags   # pushing the tag triggers .github/workflows/release.yml
```

`npm version` runs the `version` lifecycle script (`sync-version.mjs && git add -A`),
so the synced files land in the same tagged commit automatically. That's it — one
command bumps every channel, one tag ships them together.

The [`release.yml`](./.github/workflows/release.yml) workflow then:

1. **`guard`** — asserts the tag matches `package.json` and every file is in sync.
2. **`npm` / `vscode` / `desktop`** run in parallel, each with an "already published?"
   idempotency guard so re-running a partially-failed release is safe.
3. **`github-release`** — creates **one** GitHub Release for the tag with generated
   notes and attaches `NexusFlowSetup.exe`.

## Version baseline

Lockstep must never push a version *lower* than what a registry already has. When this
scheme was adopted the live maxes were npm `0.2.19` and Marketplace `1.1.0`, so the
unified line started at **`1.2.0`** (a valid increase for both). Always move forward.

Because the repository is already at `1.2.0`, the **first** release just needs the tag —
`git tag v1.2.0 && git push origin v1.2.0`. Every release after that uses `npm version`.

## Prereleases

Tags with a semver prerelease suffix (e.g. `v1.2.0-rc.1`):

- publish to npm under the `next` dist-tag (keeps `latest` stable),
- mark the GitHub Release as a prerelease,
- **skip** the Marketplace (it doesn't support semver prerelease suffixes).

Use these to rehearse the pipeline end-to-end before a real release.

## Required secrets

- `NPM_TOKEN` — npm automation token (npm job; provenance also needs the job's
  `id-token: write`, already configured).
- `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` — OIDC for `vsce publish` (no stored PAT).

## Local dry-run checks (no publishing)

```bash
node scripts/sync-version.mjs --check   # all channels agree with root
npm run build && npm pack --dry-run     # tarball contains only dist/ (+ README, LICENSE)
cd extension && npx vsce package        # produces a .vsix at the synced version
# Windows only:
npm run build && npm run build --prefix desktop && npm run build:installer --prefix desktop
```
