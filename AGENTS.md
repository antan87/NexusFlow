# NexusFlow Repository Guidance

This file contains codebase-stable instructions only. The active feature goal,
workspace scope, and sequencing live in the workspace-level `../AGENTS.md` and
take precedence for feature decisions. Do not copy a feature plan into this
repository file; doing so leaves stale guidance on later feature branches.

## Architecture

- `src/index.ts` wires the CLI; keep command handlers thin.
- `src/core/` owns workspace, Git, persistence, and orchestration behavior.
- `src/generators/` renders assistant-facing workspace artifacts.
- `src/core/storage.ts` is the port for workspace/base knowledge persistence;
  do not bypass it for documents owned by a storage adapter.
- `src/resources/` owns transactional skill and agent materialization.
- Preserve the worktree isolation model and never edit another checkout of a
  repository when the active workspace supplies a dedicated worktree.

## Generated and Durable State

- `AGENTS.md` at a generated workspace root is the canonical assistant context;
  its derived views must remain stamped and reproducible.
- Treat generated views and lockfiles as owned artifacts. Change their source or
  generator, then regenerate, instead of editing a derived view directly.
- Knowledge entries retain the 300-character body limit and must remain
  searchable, adapter-routed, and recoverable when Git persistence fails.
- Keep volatile repository state in live status/progress commands or a
  provenance-checked mechanical snapshot, not unchecked generated prose.

## Verification

- Run `npm test` for repository verification.
- Run `npm run build:backend` when TypeScript, CLI, server, or generated-resource
  code changes.
- Add negative and recovery-path tests for Git, storage-adapter, concurrency,
  and generated-context changes.
- Preserve unrelated working-tree changes and use explicit pathspecs for Git
  staging or commits.
