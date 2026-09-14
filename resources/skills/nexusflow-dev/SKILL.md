---
name: nexusflow-dev
description: Maintain ContextSpace/NexusFlow implementation, CLI, storage, generated resources, and tests. Use for changes to this codebase; projects merely using ContextSpace follow their own repository engineering standards.
metadata:
  contextspace:
    title: ContextSpace Maintainer
    category: dev-standards
    tags: [contextspace, nexusflow, architecture, testing]
---

# Maintain ContextSpace

Read the current repository instructions and assignment before editing. Keep changes
in the supplied worktree. The CLI in `src/index.ts` wires thin handlers; workspace
behavior belongs in `src/core/`, document persistence uses `src/core/storage.ts`,
and generated assistant views belong in `src/generators/`.

## Preserve implementation contracts

- Resolve brand aliases and durable paths through `src/core/constants.ts` and the
  brand configuration. Preserve primary/legacy fallback behavior.
- Use the storage port for adapter-owned documents. A local lock or cache does not
  make filesystem writes an acceptable substitute for configured storage.
- Mutate shared state through the relevant catalog or workspace API. Keep locked
  sections short; do slow verification outside them and revalidate the affected
  revision before committing its result. Read fresh state under the lock.
- Use atomic persistence at the owning storage layer. For portable resource paths,
  enforce containment and reject symlinks with the filesystem safety helpers.
- Change the source of generated views, then regenerate. Keep volatile progress
  in live state, and invalidate verification evidence when the tested input changes.
- Knowledge entries retain the 300-character body limit; preserve adapter routing,
  searchability, and recovery when Git persistence fails.

Read [CLI conventions](references/cli-conventions.md) for command changes and
[verification checks](references/verification-checklist.md) to select checks for
the affected subsystem. Follow repository-required gates before submission; use
targeted checks during iteration and repeat only when changes or failures justify it.

## Maintain the guidance too

Versioned skill sources live in `resources/skills/`; workflow templates live in
`resources/workflows/`. Installed catalog packages and generated workspace copies
are derived from those sources. See `docs/maintaining-skills.md` for validation,
scenario evaluation, installation, and regeneration. Do not hand-edit a generated
`SKILL.md` and expect refresh to preserve it.

After changing structures or resources, build the backend before running
`node dist/index.js refresh`. Distinguish successful generation from a later Git
staging failure. Report the actual state instead of claiming the entire refresh passed.
