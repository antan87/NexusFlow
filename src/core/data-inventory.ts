/** Shared factual inventory for the local guide and support-report exclusions. */
export interface DataClass {
  id: string;
  title: string;
  owner: string;
  storage: string;
  network: string;
  retention: string;
  controls: string;
  recovery: string;
}

export const DATA_INVENTORY: readonly DataClass[] = [
  {
    id: 'repositories', title: 'Repositories and worktrees', owner: 'You and Git',
    storage: 'Your source repositories and the workspace’s isolated Git worktrees.',
    network: 'Git fetch, pull and push contact the configured remote. Tools you run can send repository content to their providers.',
    retention: 'Git and filesystem lifetime. Removing a workspace force-removes its worktrees and workspace folder, including uncommitted work there. Archiving removes worktrees only when their work is clean and merged or pushed, and keeps branches.',
    controls: 'Source repositories outside the workspace remain. Deletion does not erase Git remotes or other clones.',
    recovery: 'Back up repository code and uncommitted work separately. A support report is not a code backup.',
  },
  {
    id: 'authored-context', title: 'Briefs, assignments and sources', owner: 'ContextSpace, authored by you',
    storage: 'Workspace manifest, contextspace-work.json, contextspace-document-*.md and contextspace-milestones.md. Documents use the selected storage adapter.',
    network: 'Local storage by default. Reading context with an assistant can send it through that assistant. Link attachments store the URL; viewing external links contacts their destination. Plugin adapters may use a remote store.',
    retention: 'No automatic expiry. Workspace deletion removes local documents; archiving keeps them readable. Active project-source owners cannot be deleted until sources are migrated or superseded.',
    controls: 'Manage sources in Plan. Shared project sources remain owned by their originating workspace; superseding a source does not erase its content.',
    recovery: 'General authored-state backup/restore is not yet available. Keep original documents and their metadata; generated plan text alone is insufficient.',
  },
  {
    id: 'knowledge', title: 'Workspace and repository knowledge', owner: 'ContextSpace, authored by you',
    storage: 'Workspace knowledge and .contextspace/base/<repo>/ through the storage adapter. Legacy .nexusflow locations remain readable.',
    network: 'The local adapter does not upload knowledge. Assistants reading it and optional Workroom publication have separate sharing boundaries.',
    retention: 'No automatic expiry. With the local adapter, workspace deletion removes both workspace and base knowledge in that workspace.',
    controls: 'Knowledge commands and the Knowledge view manage entries. Base knowledge is per workspace, not a global repository archive.',
    recovery: 'Preserve both workspace and base knowledge, including adapter-managed copies.',
  },
  {
    id: 'lifecycle', title: 'Milestones and verification history', owner: 'ContextSpace',
    storage: '.contextspace-state.json (or legacy state) holds lifecycle and verification state. contextspace-plan.md is a generated view.',
    network: 'Stored locally. Verification executes your configured commands, which can access the network.',
    retention: 'No automatic expiry of stored state. New verification can replace prior evidence; workspace deletion removes the local file, archiving keeps it.',
    controls: 'Edit milestones through Plan or the lifecycle commands. Passing checks describe the tested code and must be rerun after changes.',
    recovery: 'Retain authored milestone state. Old verification is historical after moving or restoring a workspace.',
  },
  {
    id: 'configuration', title: 'Preferences, projects and schedules', owner: 'ContextSpace',
    storage: 'Brand home: config.json, projects.json, schedules.json and categories.json. Adapter settings can contain private values.',
    network: 'Saving local preferences is local. Enabled schedules run configured tools; plugins/adapters can have their own network behavior.',
    retention: 'No automatic expiry. These global stores remain when an individual workspace is deleted.',
    controls: 'Settings, Projects and schedule commands manage this data. Disable a schedule before moving or recovering its workspace.',
    recovery: 'Do not share a raw configuration directory. Reconfigure credentials separately.',
  },
  {
    id: 'resources', title: 'Skills, agents and workflows', owner: 'You and resource authors',
    storage: 'Global resource catalogs, workspace materializations and Workroom review caches.',
    network: 'Importing or downloading from a remote source contacts that source. Publishing a Workroom resource shares its selected package; applying it is a separate review action.',
    retention: 'Catalog and cache copies persist until removed. Host purge cannot recall packages already downloaded by collaborators.',
    controls: 'Manage catalogs and workspace selections through Resources. Review definitions and files before applying a shared version.',
    recovery: 'Keep user-authored definitions and required payloads with their version/digest references.',
  },
  {
    id: 'chat', title: 'ContextSpace chat and approvals', owner: 'ContextSpace',
    storage: 'Brand home nexusflow.db; JSON and .bak fallback without SQLite. Workspace chat ledger: .contextspace/chat.jsonl (legacy supported).',
    network: 'Sending a prompt starts or resumes the selected assistant, which uses its provider configuration. Local history display is separate from execution.',
    retention: 'No automatic expiry. Clearing a chat deletes its stored thread/turns, not approval records or external-tool history. Workspace deletion does not clear the global chat store.',
    controls: 'Clear-chat controls affect the ContextSpace conversation. The workspace ledger and global database are different stores; no unified purge control is provided.',
    recovery: 'Not included in support reports. General conversation recovery is not provided by Workroom export.',
  },
  {
    id: 'external-history', title: 'Assistant-owned history', owner: 'Your assistant tools',
    storage: 'Tool-specific homes, such as Claude projects, Codex sessions, Copilot’s session store and other supported session sources; tool environment overrides apply.',
    network: 'Discovery reads local history. Resume/launch delegates to the selected assistant and its configured provider. Tool retention and sharing settings apply.',
    retention: 'Controlled by each tool. ContextSpace workspace removal and clear-chat do not delete the source histories.',
    controls: 'Use the original tool to manage its history, credentials and retention.',
    recovery: 'Back up or export through the original tool. ContextSpace diagnostics never include transcripts.',
  },
  {
    id: 'credentials', title: 'Credentials and active access', owner: 'Your tools and ContextSpace Workrooms',
    storage: 'Tool auth stores/environment; Workroom credential and TLS key files. The scoped host agent token is persisted with restricted file permissions; host human authority is password-encrypted.',
    network: 'Credentials authenticate explicit assistant or Workroom operations to the selected provider/host. They are not diagnostic fields.',
    retention: 'Tool-specific. Workroom credentials can be revoked/rotated; removing local data is not the same as revoking remote access.',
    controls: 'Use tool sign-out and Workroom access controls. OS account access remains a security boundary.',
    recovery: 'Re-authenticate separately. Never include auth files, tokens or private keys in a support report.',
  },
  {
    id: 'workrooms', title: 'Workroom shared data', owner: 'Room host and participants',
    storage: 'Brand home workrooms/<roomId>/workroom.sqlite and resource packages; participants may retain downloaded copies.',
    network: 'Explicit start/join/publish uses a separate HTTPS endpoint on a selected LAN/VPN address. Shared documents, activity and resource packages go to the host and authorized participants.',
    retention: 'Stopping/leaving is not erasure of every copy. Room history/package limits bound some retained data. Peer downloads cannot be recalled by host purge.',
    controls: 'Review the sharing preview, manage members, rotate/revoke access and use the host’s encrypted room export. Pattern warnings do not guarantee secret removal.',
    recovery: 'Encrypted Workroom export/import recovers room data with new credentials. It is not a full ContextSpace profile backup.',
  },
  {
    id: 'logs', title: 'Logs and support reports', owner: 'ContextSpace and invoked services',
    storage: '.contextspace-logs (legacy supported), process/desktop logs and debug stderr. The support report is saved only where you choose.',
    network: 'Logs are shown locally; commands/services may have their own logging destinations. Saving diagnostics does not upload them.',
    retention: 'No ContextSpace-wide log expiry or rotation policy. A service/process manager may have its own policy. Saved reports remain until you delete them.',
    controls: 'Review the exact diagnostic payload and remove sections before saving. Reports exclude raw logs, arbitrary errors, full config/environment, content and credentials.',
    recovery: 'A support report contains status fields only and cannot restore your work.',
  },
  {
    id: 'generated', title: 'Generated context and caches', owner: 'ContextSpace',
    storage: 'Workspace assistant instructions, generated views, analysis caches and runtime/lock files.',
    network: 'Generation is local; assistants may read the resulting context and transmit it under their own settings.',
    retention: 'Regenerated or replaced by workspace operations; local copies are removed with the workspace. No universal timed expiry.',
    controls: 'Refresh from authored sources. Do not treat generated views or old runtime state as the authoritative backup.',
    recovery: 'Regenerate owned views. Preserve separately authored files and source documents.',
  },
  {
    id: 'updates', title: 'Update checks and downloads', owner: 'ContextSpace and upstream registries',
    storage: 'Release metadata cached in config for 24 hours; tool-version cache is in memory for 60 seconds.',
    network: 'Interactive CLI commands can check api.github.com for release metadata. The dashboard checks releases, and Check Now queries registry.npmjs.org for installed tools. Packaged desktop checks GitHub releases separately. Requests reveal IP/network metadata and product/package identity, not workspace content; installing downloads software.',
    retention: 'Local caches are replaced on later checks. Upstream services control their own request-log retention.',
    controls: 'Data guide and diagnostics CLI commands skip the CLI update hook. Toolchain checks in Settings require Check Now. Dashboard/desktop release checks have separate behavior; this is not a global offline switch.',
    recovery: 'Update caches are not authored data and do not need restoration.',
  },
];

export const DIAGNOSTIC_EXCLUSIONS = [
  'repositories', 'authored-context', 'knowledge', 'lifecycle', 'configuration',
  'resources', 'chat', 'external-history', 'credentials', 'workrooms', 'logs', 'generated',
] as const;
