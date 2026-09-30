# Data, privacy and local support reports

Open **Settings → Data and privacy** for the maintained inventory of storage,
sharing triggers, retention, deletion controls and recovery limits. Expand a data
class to see who owns it. **Local profile locations** shows resolved primary,
legacy or custom paths privately; those paths are never diagnostic fields.

The same inventory is available offline in the CLI:

```bash
ctxspace data
ctxspace data --json
```

`data --json` contains private profile paths. It is a local guide, not a support
report. Plugin adapters and assistant tools control their own storage/network
behavior. Loading an installed plugin may itself execute plugin code.

## Review before sharing

In Settings, select a report scope and choose **Preview diagnostics**. You can
remove sections. **Download reviewed report** downloads exactly the preview;
it does not upload it. Cancel discards the preview. Browser downloads use the
browser's destination and overwrite controls.

Reports contain only version/platform fields, anonymous workspace/repository
aliases, counts and a small set of file/directory status codes. Checks inspect
workspace manifest metadata and local file existence, not file contents. Plugin
document stores are reported as not checked to avoid implicit remote access.
This is a limited support report, not the full `doctor` analysis.

Code, diffs, authored documents, knowledge, transcripts, attachments, raw logs,
arbitrary error text, full configuration/environment, credentials and Workroom
databases are excluded. There is no raw-log option. This avoids relying on a
pattern scanner to recognize every possible secret.

For the CLI, capture a sanitized candidate, read the entire `content` in the JSON
preview, and use its `digest` to confirm that exact captured report:

```bash
ctxspace diagnostics preview /path/to/workspace --candidate candidate.json
ctxspace diagnostics export candidate.json --digest <digest-from-preview> --output report.json
```

Use `--omit runtime workspace` on `preview` to exclude those sections. Omitting a
workspace argument uses the current workspace when present, otherwise runtime
fields only. Candidate/output names must be new files in existing writable
folders without linked path components. Existing files are never replaced.
Malformed candidates and mismatched digests fail with nonzero exit status and
fixed error messages. Export reads the candidate, not live workspace state.
Cancel by not running `export`; remove the local candidate when no longer needed.
Interrupted publication cannot expose a partial final report, but a forced
process termination can leave a sanitized `.contextspace-diagnostics-*.tmp` file
in the chosen folder. Delete that temporary file when the process is stopped.

The guide and diagnostics CLI commands skip ContextSpace's post-command update
check. Opening Settings does not check npm for toolchain updates; **Check Now**
does. Dashboard release checks, packaged desktop updates, assistant execution,
Git operations and plugin behavior are separate outbound paths described in the
inventory. This feature is not a global offline mode.

## Deletion and recovery are separate

Workspace deletion removes its folder and associated worktrees. It does not
erase source repositories outside the workspace, Git remotes, global chat and
approval storage, vendor histories, or every copy of Workroom data. Clearing a
ContextSpace chat does not delete the original assistant's history. There is no
secure-erasure promise for recovery copies, OS backups or deleted filesystem
blocks.

Workrooms already offer a specialized encrypted room export/import. It is not a
full profile backup. General authored-state backup/restore is a later milestone;
diagnostic reports cannot restore your work. Keep repository code, original
authored sources, metadata and tool-owned history backed up separately.

The inventory is maintained in `src/core/data-inventory.ts` and served to both
CLI and GUI. Update it with persistence, networking or deletion changes and
verify claims using disposable profiles before publishing broader promises.
