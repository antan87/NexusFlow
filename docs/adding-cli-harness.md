# Adding a CLI harness

A harness is declared once, in `src/harness/manifest.ts`. Everything else in
this document is derived from that entry: the terminal target list, launch
validation, the assistant union, workspace detection, the config schema, the
MCP config targets, the skill roots, and the session sources. A harness present
in the manifest but not wired into a consumer fails
`src/harness/manifest.invariants.test.ts`.

## The manifest entry

```ts
claude: {
  id: 'claude',
  label: 'Claude Code',
  role: 'assistant',                                  // or 'session-only'
  detection: { kind: 'binary', probe: 'claude', launchCommand: 'claude' },
  context: { kind: 'native-agents-md' },               // or import / own-file
  skills: [CLAUDE_SKILLS],
  mcp: [ROOT_MCP],                                     // omit for a user-level config
  terminal: { resumeArgs: (id) => ['--resume', id], continueArgs: ['--resume'], history: true },
  vendor: 'claude-code',                               // only with a normalized adapter
  chatProviderIds: ['claude-cli', 'claude-sdk'],      // references, never inlined
},
```

Three fields decide most of what else you have to write:

- **`role`** — `assistant` means selecting it generates context, skills and MCP
  config; `session-only` means it is launchable and resumable but generates
  nothing. Promotion is a one-line change that the invariant test fails on until
  it is reviewed, which is the point.
- **`detection.kind`** — `binary` is installed by a command on PATH and can host
  a terminal session; `api-key` is configured by a credential and has no local
  command, so it is excluded from terminal launch and session discovery.
- **`context.kind`** — `native-agents-md` needs no generator, because
  `AGENTS.md` is written unconditionally. Use `import` for a file that imports
  it, `own-file` for a harness-specific instruction file that needs a generator
  in `src/generators/index.ts`.

## Saved conversations

Implement the `SessionReader` interface in a provider module and register it once
in `src/utils/session-readers.ts`. Its three operations list sessions, check for
any workspace sessions, and read a transcript. Set `terminal.history: true` only
after registering a reader: the reader registry's type is derived from the
manifest, so a history source without a reader fails the backend build. The GUI
requests `/api/session-sources` and loads each source independently. Existing
Antigravity, Claude, Codex and Copilot readers still live in `session-finder.ts`;
new readers use separate modules.

Return `AISession` records with the provider's real session ID and
`recordedCwd`. The terminal API checks that cwd against the workspace before
direct resume. Embedded terminal resume currently accepts UUID session IDs;
another ID format needs a targeted validation change and test.

## Workspace assistants

Assistant-only integrations are opt-in, and only when they are actually
supported:

| Capability | Owning code |
| --- | --- |
| Terminal start and resume | `terminal` on the manifest entry |
| Saved history, activity, transcripts | Provider reader + `session-readers.ts` |
| GUI display name | `/api/harnesses` (the manifest) |
| GUI icon | `gui/src/components/icons/HarnessIcon.tsx` |
| Workspace context and resources | `context`, `skills`, `mcp` on the manifest entry |
| Embedded chat provider | `ProviderRegistry` in `src/agent/adapters.ts` |

`AIAssistant`, the picker, `config-schema` and `detect-ai` all derive from the
manifest's `role`, so none of them needs an edit. The icon map is the one thing
that stays in the renderer: a component and a class name are not data. It falls
back to a neutral glyph, so a harness with no logo still renders correctly.

## MCP

`mcp` lists the config files the harness reads, at most one entry per path. A
harness that reads MCP only through an extension — pi has no MCP client in its
own binary — must say so with `mcpViaExtension`, which surfaces in
`/api/harnesses` and produces a workspace-check warning.

A native API provider has no MCP client of its own at all. The SDK-backed native
agents reach the workspace server through `src/agent/nativeMcp.ts`; a new native
agent must use that bridge or its generated `.mcp.json` will be unread config.

## Tests

`src/harness/manifest.invariants.test.ts` covers the wiring. A normalized
adapter must satisfy the shared suite: `assertHarnessContract` from
`src/harness/contract-suite.ts`, supplied with a driver rather than a copied set
of assertions. Backend tests should cover workspace matching, malformed history
and launch args; GUI tests should cover progressive loading and direct resume.
