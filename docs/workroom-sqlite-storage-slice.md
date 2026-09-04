# Workroom SQLite storage slice

## Outcome

A hosted Workroom keeps its durable collaboration state in a host-local SQLite database, so restarting NexusFlow preserves the same documents, participants, workflow, resources, and activity without depending on whole-file JSON replacement.

## Scope

- Add an application-owned `WorkroomStore` port and a `node:sqlite` adapter.
- Store the bounded `StoredWorkroomV1` aggregate in a validated singleton row with an explicit storage-schema migration record, SQLite-native cross-process resource-lifecycle transactions, and digest-constrained writes.
- Keep immutable resource-package payloads in the existing `blobs/` directory for this slice.
- Create new rooms directly as SQLite databases.
- On password-verified resume, migrate an existing `room.json` through a temporary database, integrity verification, and no-overwrite hard-link promotion. Preserve the JSON as `room.v1.json.backup`; merely listing paused rooms does not migrate them.
- Require Node.js 22.13 or newer and test supported Node 22 and 24 runtimes.

## Non-goals

- A new chat/message API, threads, reactions, unread state, or search.
- Normalizing every aggregate field into a separate SQL table.
- SQLCipher or a promise of encrypted local storage.
- Opening the database from guest machines or over a network filesystem.
- Automatically rolling back to JSON after SQLite has accepted newer writes.

## Owned paths and contracts

- `src/workrooms/store.ts`: persistence port and validated stored-state contract.
- `src/workrooms/sqlite-store.ts`: SQLite schema, migration, transactions, and package-file adapter.
- `src/workrooms/service.ts`: depends on the port rather than a concrete adapter.
- `src/workrooms/host.ts`: composes the SQLite adapter.
- `src/workrooms/workrooms.test.ts`: persistence, migration, corruption, restart, and concurrency evidence.
- `package.json`, CI, and desktop verification: supported runtime and packaged availability.

The HTTP, invite, snapshot, export, and UI contracts remain unchanged. `workroom.sqlite` is authoritative once present. SQLite is used only by the host process on local disk; guests continue through the authenticated HTTPS API.

## Risk

High. This is a durable-data migration and changes the minimum Node.js runtime. A defect could make an existing room unavailable or accept a stale concurrent write.

## Acceptance and failure behavior

- A new room creates `workroom.sqlite`, passes `PRAGMA quick_check`, and survives a fresh store/service instance.
- Mutations and resource-blob cleanup run inside SQLite write transactions shared across host processes, then commit with a state-digest constraint; a concurrent writer cannot replace newer state or remove a committed blob.
- A valid legacy `room.json` migrates without changing its parsed state or resource blobs, and the original file remains as a pre-migration backup.
- An invalid legacy file leaves the original untouched and creates no authoritative database.
- An unsupported schema or corrupt authoritative database fails closed with a recovery-oriented error; it never silently falls back to the stale backup.
- Export/import, pause/resume, document conflicts, retention limits, and resource cleanup continue to behave as before.

## Compatibility and recovery

Node 20 is intentionally removed because it is end-of-life and does not provide unflagged `node:sqlite`; Node 22.13+ avoids native addon and Electron ABI packaging risk.

Migration is forward-only during password-verified resume. Recovery keeps the database and backup intact: copy both first, then either forward-repair/import into a new Workroom or deliberately restore `room.v1.json.backup` as `room.json` with an older NexusFlow version. Restoring the backup cannot include writes made after migration.

## Evidence plan

- Focused store tests for new database initialization, restart, legacy migration, migration rejection, SQLite corruption, and stale compare-and-swap.
- Existing Workroom security, authorization, resource, workflow, export/import, pause/resume, and network tests.
- Backend build, full test suite, supported-runtime CI, and packaged Electron verification.
- Read-only primary review plus a separate persistence/security review of the frozen diff.

Author: Codex primary implementation agent. Reviewers: independent read-only correctness and persistence/security agents.
