# Releasing ContextSpace

ContextSpace ships three artifacts from this one repository, all in **lockstep** on a
single version:

| Channel | Artifact | Published to |
| --- | --- | --- |
| npm | `@mrpatronz/nexusflow` (CLI + server + bundled GUI) | npm registry |
| VS Code extension | `ContextSpace.vsix` (`contextspace.contextspace-vscode`) | GitHub Releases; optional VS Code Marketplace |
| Desktop | `ContextSpaceSetup.exe` (Windows NSIS), `ContextSpace-<version>.AppImage` (Linux), plus `latest.yml`/`latest-linux.yml` and `.sha256` sidecars | GitHub Releases |

The npm package identity remains `@mrpatronz/nexusflow` for existing installs and
trusted publishing. The product and primary CLI command are ContextSpace and `ctxspace`.
Stable GitHub Releases include an installable VSIX even when Marketplace publishing is disabled.
The Marketplace channel is optional until its publishing variable and credentials are enabled.

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

After the PR is merged, wait until every required check (see [Publish gate](#publish-gate))
has succeeded on the merge commit, then dispatch the release using the exact version
in the merged `package.json` and **pin the commit you verified** with `expected_sha`.
Dispatch always loads the tip of `main`; if another PR merged after you verified, a
pinned release fails instead of shipping a commit you did not check. You can trigger
it either from GitHub Actions UI (**Actions** -> **Release** -> **Run workflow**,
entering the version and the SHA) or via `gh`:

```bash
VERSION=$(node -p "require('./package.json').version")
SHA=$(git rev-parse origin/main)   # the commit whose checks you verified
gh api "repos/antan87/NexusFlow/dispatches" \
  -f event_type=release \
  -F "client_payload[version]=$VERSION" \
  -F "client_payload[expected_sha]=$SHA"
```

Or using `gh workflow run`:

```bash
VERSION=$(node -p "require('./package.json').version")
SHA=$(git rev-parse origin/main)   # the commit whose checks you verified
gh workflow run release.yml -f version=$VERSION -f expected_sha=$SHA
```

`expected_sha` is optional so existing dispatch commands keep working, but an
unpinned dispatch releases whatever `main` is at when the workflow starts.

The `npm version` command runs the `version` lifecycle script
(`sync-version.mjs && git add -A`), so all channel manifests are reviewed in the
same PR. The repository-dispatch event loads the workflow from protected `main`;
it does not rely on a tag push triggering workflow code from an unreviewed ref.

The [`release.yml`](./.github/workflows/release.yml) workflow then:

1. **`guard`** — rejects any ref other than `main`, verifies the source is on `main`,
   checks the requested version against `package.json`, runs the sync check, checks the
   pinned `expected_sha` (when given) and that the version is not lower than any existing
   release tag, requires every check in `.github/release-required-checks.json` to have
   succeeded on this exact SHA, and only then creates the immutable tag.
2. **`npm` / `vscode` / `desktop`** run in parallel. npm and Marketplace skip versions
   that are already published; desktop rebuilds its installers and metadata on each
   run. Stable releases always package the VSIX. npm uses trusted OIDC publishing;
   Marketplace publishing runs only when
   the repository variable `VSCODE_PUBLISHING_ENABLED=true` and Azure OIDC credentials
   are present.
3. **`github-release`** — creates **one** GitHub Release for the tag with generated
   notes and attaches the stable-release VSIX, both desktop installers, their checksum sidecars, and the
   electron-updater metadata (`latest.yml` and `latest-linux.yml`). It then writes a
   channel-status table to the run summary.

Every job checks out the guard-approved SHA, and the jobs that hold publish
credentials (`npm`, `vscode`, `github-release`) run in the `release` environment.

## Publish gate

Nothing publishes unless every required check succeeded on the exact source SHA.
The guard fails closed: a required check that is missing, queued, in progress,
skipped, neutral, cancelled, failed, reported by an app other than GitHub Actions,
or recorded for a different SHA blocks the release. The same applies when GitHub's
check-run API cannot be read completely. When a check was re-run, its latest run decides.

The required checks are listed in
[`.github/release-required-checks.json`](./.github/release-required-checks.json):
every job in `ci.yml` and `security.yml`. `npm test` derives the expected names from
those workflows and fails when the list drifts, so a new CI job must be added
there (and to branch protection) in the same PR. Required jobs must not be
conditional, because a skipped required check would block every release.

If a required check fails, fix it on `main` and release the fixing commit; do not
re-dispatch against a commit you believe is flaky until its check is re-run green.

Check what the guard would decide, without publishing:

```bash
GH_TOKEN=$(gh auth token) node scripts/release-guard.mjs checks \
  --sha "$(git rev-parse origin/main)" --repo antan87/NexusFlow
```

### Several releases at once

Only one release runs at a time (the `release` concurrency group), and a run that is
waiting for approval in the `release` environment keeps the group. GitHub keeps at most
one pending run per group, so a newer pending dispatch silently cancels an older one.
Before bumping or dispatching, check what is already in flight and do not dispatch a
version that already has a run:

```bash
gh run list --workflow release.yml --limit 5 \
  --json databaseId,status,conclusion,headSha,createdAt \
  --jq '.[] | "\(.createdAt) \(.status)/\(.conclusion) \(.headSha[0:7]) \(.databaseId)"'
```

The guard enforces two rules that do not depend on anyone checking first:

- **Versions move forward.** A version lower than any existing `vX.Y.Z[-pre]` tag is
  refused, so a stale bump cannot publish after a newer release and move npm's `latest`
  back. The same version is allowed so a partial release can be re-run. There is no
  override; releasing a lower version (a backport) needs a pipeline change first.
- **The source is the commit you verified.** With `expected_sha`, a release fails when
  `main` has moved past it. Verify the new head and dispatch again.

### Owner-applied repository settings

The workflow cannot configure these itself. Apply and review them as the repository owner:

1. **Required status checks on `main`**: the same names as the JSON list, from the
   GitHub Actions app, so an unchecked commit cannot merge either:

   ```bash
   jq '{strict: false, checks: [.checks[] | {context: ., app_id: 15368}]}' \
     .github/release-required-checks.json |
     gh api -X PATCH repos/antan87/NexusFlow/branches/main/protection/required_status_checks --input -
   ```

   (`15368` is the GitHub Actions app ID; confirm it with
   `gh api repos/antan87/NexusFlow/commits/<sha>/check-runs --jq '.check_runs[0].app.id'`.)
2. **Include administrators** (`enforce_admins`) so direct pushes cannot skip those checks.
3. **`release` environment**: deployment branches limited to `main`, and the owner as the
   required reviewer. The branch policy is what stops a workflow edited on another
   branch from reaching the credentials; the guard's ref check only fails early.
4. **Credentials bound to the environment**: set the npm trusted publisher's environment
   to `release`. If Marketplace publishing is enabled, give the Azure federated credential
   the subject `repo:antan87/NexusFlow:environment:release`. Keep no long-lived publish
   tokens as repository secrets; any workflow run can read those.

### Emergency releases

There is no check bypass. For an urgent fix, the owner may merge the fix without
waiting for review, but the release still needs every required check green on
that exact commit and the owner's approval in the `release` environment. Both
are recorded in the run log.

### Channel status

A VS Code Marketplace failure does not stop npm, the desktop installers or the
GitHub Release. The channel is reported as `failed` in the run summary, and the run
ends red. After fixing the Marketplace credentials, re-run the whole workflow: the
tag, npm and Marketplace steps are idempotent for an already-published version.

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
  the workflow requests `id-token: write` from the `release` environment and does
  not use an `NPM_TOKEN` secret.
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
ctxspace desktop install
```

## Upgrade compatibility

Keep the published npm identity, legacy CLI alias, and desktop application ID stable.
The renamed desktop app reuses an existing NexusFlow profile when no ContextSpace
profile exists. On Linux, CLI installation updates an existing NexusFlow AppImage
and desktop entry in place; fresh installs use ContextSpace paths.

The Windows packaging job also downloads and verifies the published 2.9.0 installer,
installs it on a disposable runner, and upgrades it with the candidate installer.
It checks the existing install directory/uninstall registration, launches both
installed versions, and verifies profile, persistent browser data, workspace
configuration, and knowledge-file continuity. This check runs before the ordinary
packaged-app test so a fresh ContextSpace profile cannot mask a migration failure.
