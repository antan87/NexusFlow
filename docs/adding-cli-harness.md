# Adding a CLI harness

CLI chat and saved conversations share one backend catalog in
`src/utils/cli-harnesses.ts`. Add the harness ID, display name, binary,
resume arguments, and history capability there. The terminal target list,
launch validation, external terminal command, and GUI history source list
then use that registration. The GUI requests `/api/session-sources` and does
not keep its own source array.

For saved conversations, add a reader under `src/utils/` and call it from
`findSessions` in `src/utils/session-finder.ts`. Return `AISession` records
with the provider's real session ID and `recordedCwd`; the latter is checked
against the workspace before direct resume. Also wire a transcript reader
and active-session detection there. Set `history: true` in the catalog only
after those readers exist. Embedded terminal resume currently accepts UUID
session IDs; another ID format needs a targeted validation change and test.

Add the harness icon and name in `gui/src/components/icons/HarnessIcon.tsx`.
Overview, session history, terminal selection, and the workspace sidebar use
that component. Add a fallback icon only when the harness has no distinct
asset. GUI tests should cover progressive loading and direct resume; backend
tests should cover workspace matching, malformed history, and launch args.

Workspace setup assistants, resource adapters, and embedded chat providers
are separate capabilities. A CLI harness need not implement them. Extend
`AIAssistant`, detection, resources, or `gui/src/features/chat/chatLaunch.ts`
only when that integration is actually supported.
