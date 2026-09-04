# Workroom Handoff Stream slice

## Outcome

An accepted host or guest lands in a lightweight Handoff Stream that explains what happened, who acted, what evidence exists, and which workflow turn is next. Administrative and security controls remain available through a compact tools menu instead of dominating the room.

## Scope

- Redesign only the active-room experience after a host or guest has an authorized snapshot.
- Present existing room activity, workflow progress, participants, feature context, and room metadata in the stream layout.
- Allow a developer to post a short shared handoff update through the existing revision-checked `handoff` document endpoint.
- Keep invitations, context editing, resource review, workflow administration, membership, the full activity log, security, encrypted export, stop/leave, locked recovery, disconnected recovery, room creation, joining, and import behavior reachable and unchanged.
- Add focused browser regression coverage for stream rendering, tool navigation, and handoff-update conflict recovery.

## Non-goals

- No chat service, attachment upload, transcript collection, automatic diff sharing, new participant roles, or new server contract.
- No change to listener binding, TLS pinning, password/device credentials, authorization, resource approval, export encryption, or retention.
- No claim that a human participant is an AI agent; the UI displays only roles present in the current snapshot.

## Dependencies and contracts

- Input contract: `WorkroomSnapshot` and `WorkroomStatus` in `gui/src/types.ts`.
- Existing read path: `GET /api/workrooms/status` with the same-origin Workroom bootstrap boundary.
- Existing mutation for stream posts: `PUT /api/workrooms/documents/handoff` with `expectedRevision`.
- Existing mutations and permissions for invitations, resources, workflows, membership, security, export, and stop/leave remain owned by `WorkroomsPage`.
- Existing NexusFlow Inter/JetBrains Mono fonts, semantic color tokens, buttons, badges, text areas, and menu primitives are reused.

## Owned paths

- `gui/src/features/workrooms/HandoffStream.tsx` — new active-room presentation and interaction shell.
- `gui/src/pages/WorkroomsPage.tsx` — composition, existing secure mutations, tool views, and conflict-preserving stream-post adapter.
- `gui/e2e/workrooms.spec.ts` — observable behavior and recovery coverage.
- `docs/workroom-handoff-stream-slice.md` — slice boundary and evidence contract.

## Risk

High review tier because the UI sits on an authorization/session boundary and exposes membership, export, and resource controls, even though server authorization and contracts are unchanged. The primary risks are hiding a recovery/security action, making an unavailable action appear authorized, losing a draft on optimistic-concurrency conflict, or presenting inferred agent identity as fact.

## Acceptance criteria

1. An authorized active room opens on `Handoff Stream` with live state, feature goal, current workflow status, chronological activity, active participants, and room details.
2. Host-only invitation creation remains host-only. Guests do not receive a host control through the redesign.
3. The tools menu reaches project/privacy overview, shared context, resources, workflow, people, full activity, and security/export; each tool view returns to the stream.
4. Posting an update appends reviewed user text to the shared `handoff` document with the current expected revision. Success clears the composer; a `409` keeps the typed update and reports the conflict.
5. The stream never auto-collects or implies collection of code, filenames, diffs, paths, credentials, terminal/editor state, or AI transcripts.
6. The primary path is keyboard operable, labeled, responsive at narrow widths, and honors the existing reduced-motion rule.
7. Locked, idle, pending, rejected, disconnected, room setup, import, and recovery behavior continues to pass existing tests.

## Failure and recovery behavior

- Status polling failure keeps the last authorized snapshot and reports an error only for an explicit refresh.
- Revision conflict refreshes server state, preserves the composer text, and asks the developer to compare and retry.
- Stop/leave remains an explicit user action; server persistence/recovery behavior remains unchanged.
- If the redesign must be rolled back, remove the stream component and restore the previous active-room tab header; no data migration or server rollback is required.

## Test and evidence plan

- Build and lint the GUI.
- Run focused Workroom Playwright tests covering host stream content, menu navigation, successful handoff update, and conflict draft preservation.
- Run root `npm test` and `npm run build:backend` because this branch contains the wider Workroom feature and its trust-boundary regression suite.
- Capture the active room in the browser at the selected desktop viewport and a narrow viewport; compare it with the selected Handoff Stream mockup.
- Check browser console output and keyboard focus on the stream, composer, menu, and return path.
- Produce a fixed diff for a separate primary reviewer and a fresh security specialist reviewer.

## Ownership

- Author/integrator: primary Codex agent.
- Independent primary reviewer: fresh read-only reviewer assigned after the implementation diff is fixed.
- Security specialist: fresh read-only reviewer assigned after the implementation diff is fixed.
- Promotion owner: human repository owner through PR review and protected CI.
