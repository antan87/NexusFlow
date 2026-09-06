/**
 * @module brand
 * Centralized, strongly typed brand configuration and reusable identity constants
 * for the ContextSpace GUI and web client.
 *
 * All frontend views (onboarding, guide, workrooms, workspaces, settings, launcher, sidebar)
 * consume this module instead of hardcoding product names or resources.
 */

export const BRAND_CONFIG = {
  identity: {
    name: 'ContextSpace',
    shortName: 'CS',
    legacyName: 'NexusFlow',
    cliName: 'ctxspace',
    legacyCliName: 'nexusflow',
    tagline: 'Deterministic AI Context Engine & Multi-Repo Workspace Orchestrator',
  },
  files: {
    overview: 'contextspace-overview.md',
    legacyOverview: 'nexusflow-overview.md',
    knowledge: 'contextspace-knowledge.md',
    legacyKnowledge: 'nexusflow-knowledge.md',
    plan: 'contextspace-plan.md',
    legacyPlan: 'nexusflow-plan.md',
    manifest: 'contextspace.json',
    legacyManifest: 'nexusflow.json',
    handoff: 'contextspace-handoff.md',
    legacyHandoff: 'nexusflow-handoff.md',
    cursorRules: 'contextspace.mdc',
    legacyCursorRules: 'nexusflow.mdc',
    configDir: '.contextspace',
    legacyConfigDir: '.nexusflow',
  },
  github: {
    owner: 'antan87',
    repo: 'NexusFlow',
    repoUrl: 'https://github.com/antan87/NexusFlow',
    releaseUrl: 'https://github.com/antan87/NexusFlow/releases/latest',
  },
  headers: {
    workroomBootstrap: 'X-ContextSpace-Workroom-Bootstrap',
    legacyWorkroomBootstrap: 'X-NexusFlow-Workroom-Bootstrap',
  },
  cookies: {
    workroomBootstrap: 'contextspace_workroom_bootstrap',
    legacyWorkroomBootstrap: 'nexusflow_workroom_bootstrap',
    workroomHuman: 'contextspace_workroom_human',
    legacyWorkroomHuman: 'nexusflow_workroom_human',
  },
  extension: {
    name: 'ContextSpace',
    legacyName: 'NexusFlow',
  },
  resources: {
    catalogName: 'ContextSpace',
    legacyCatalogName: 'NexusFlow',
  },
  workrooms: {
    roomExportExtension: '.contextspace-room.json',
    legacyRoomExportExtension: '.nexusflow-room.json',
    inviteProtocol: 'contextspace:',
    legacyInviteProtocol: 'nexusflow:',
  },
  storage: {
    themeKey: 'contextspace-theme',
    legacyThemeKey: 'nexusflow-theme',
    chatPrefix: 'contextspace_chat_',
    legacyChatPrefix: 'nexusflow_chat_',
    chatLaunchConsumedKey: 'contextspace.chatLaunch.consumed',
    legacyChatLaunchConsumedKey: 'nexusflow.chatLaunch.consumed',
  },
} as const;

export const BRAND_NAME = BRAND_CONFIG.identity.name;
export const LEGACY_BRAND_NAME = BRAND_CONFIG.identity.legacyName;
export const CLI_NAME = BRAND_CONFIG.identity.cliName;
export const LEGACY_CLI_NAME = BRAND_CONFIG.identity.legacyCliName;
export const BRAND_SHORT_NAME = BRAND_CONFIG.identity.shortName;
export const BRAND_TAGLINE = BRAND_CONFIG.identity.tagline;

export const OVERVIEW_FILE = BRAND_CONFIG.files.overview;
export const LEGACY_OVERVIEW_FILE = BRAND_CONFIG.files.legacyOverview;
export const KNOWLEDGE_FILE = BRAND_CONFIG.files.knowledge;
export const LEGACY_KNOWLEDGE_FILE = BRAND_CONFIG.files.legacyKnowledge;
export const PLAN_FILE = BRAND_CONFIG.files.plan;
export const LEGACY_PLAN_FILE = BRAND_CONFIG.files.legacyPlan;
export const CONFIG_DIR = BRAND_CONFIG.files.configDir;
export const LEGACY_CONFIG_DIR = BRAND_CONFIG.files.legacyConfigDir;

export const GITHUB_REPO_URL = BRAND_CONFIG.github.repoUrl;
export const GITHUB_RELEASE_URL = BRAND_CONFIG.github.releaseUrl;

export const WORKROOM_BOOTSTRAP_HEADER = BRAND_CONFIG.headers.workroomBootstrap;
export const LEGACY_WORKROOM_BOOTSTRAP_HEADER = BRAND_CONFIG.headers.legacyWorkroomBootstrap;
export const EXTENSION_NAME = BRAND_CONFIG.extension.name;
export const LEGACY_EXTENSION_NAME = BRAND_CONFIG.extension.legacyName;
export const CATALOG_NAME = BRAND_CONFIG.resources.catalogName;
export const LEGACY_CATALOG_NAME = BRAND_CONFIG.resources.legacyCatalogName;
export const WORKROOM_ROOM_EXTENSION = BRAND_CONFIG.workrooms.roomExportExtension;
export const WORKROOM_LEGACY_ROOM_EXTENSION = BRAND_CONFIG.workrooms.legacyRoomExportExtension;
export const WORKROOM_INVITE_PROTOCOL = BRAND_CONFIG.workrooms.inviteProtocol;
export const WORKROOM_LEGACY_INVITE_PROTOCOL = BRAND_CONFIG.workrooms.legacyInviteProtocol;
export const THEME_STORAGE_KEY = BRAND_CONFIG.storage.themeKey;
export const LEGACY_THEME_STORAGE_KEY = BRAND_CONFIG.storage.legacyThemeKey;
export const CHAT_STORAGE_PREFIX = BRAND_CONFIG.storage.chatPrefix;
export const LEGACY_CHAT_STORAGE_PREFIX = BRAND_CONFIG.storage.legacyChatPrefix;
export const CHAT_LAUNCH_CONSUMED_KEY = BRAND_CONFIG.storage.chatLaunchConsumedKey;
export const LEGACY_CHAT_LAUNCH_CONSUMED_KEY = BRAND_CONFIG.storage.legacyChatLaunchConsumedKey;
