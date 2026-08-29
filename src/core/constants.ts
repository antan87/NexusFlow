/**
 * @module core/constants
 * Centralized constants and resolution helpers for ContextSpace brand naming,
 * file names, legacy compatibility fallbacks, and environment variables.
 *
 * All constants are strongly typed and derived directly from BRAND_CONFIG.
 */

import { BRAND_CONFIG } from './brand-config.js';

export * from './brand-config.js';

export const BRAND_NAME = BRAND_CONFIG.identity.name;
export const CLI_NAME = BRAND_CONFIG.identity.cliName;
export const CLI_ALIASES = BRAND_CONFIG.identity.cliAliases;
export const MCP_SERVER_NAME = BRAND_CONFIG.mcp.serverName;
export const LEGACY_MCP_SERVER_NAME = BRAND_CONFIG.mcp.legacyServerName;

// Workspace Manifests
export const PRIMARY_MANIFEST_FILE = BRAND_CONFIG.files.manifest.primary;
export const LEGACY_MANIFEST_FILE = BRAND_CONFIG.files.manifest.legacy;

// Integrity Lockfiles
export const PRIMARY_LOCK_FILE = BRAND_CONFIG.files.lock.primary;
export const LEGACY_LOCK_FILE = BRAND_CONFIG.files.lock.legacy;

// Durable Workspace Memory & Generated Views
export const PRIMARY_KNOWLEDGE_FILE = BRAND_CONFIG.files.knowledge.primary;
export const LEGACY_KNOWLEDGE_FILE = BRAND_CONFIG.files.knowledge.legacy;

export const PRIMARY_PLAN_FILE = BRAND_CONFIG.files.plan.primary;
export const LEGACY_PLAN_FILE = BRAND_CONFIG.files.plan.legacy;

export const PRIMARY_OVERVIEW_FILE = BRAND_CONFIG.files.overview.primary;
export const LEGACY_OVERVIEW_FILE = BRAND_CONFIG.files.overview.legacy;

export const PRIMARY_HANDOFF_FILE = BRAND_CONFIG.files.handoff.primary;
export const LEGACY_HANDOFF_FILE = BRAND_CONFIG.files.handoff.legacy;

// IDE Rules
export const PRIMARY_CURSOR_RULE_FILE = BRAND_CONFIG.files.cursorRule.primary;
export const LEGACY_CURSOR_RULE_FILE = BRAND_CONFIG.files.cursorRule.legacy;

// User Config Directory
export const PRIMARY_CONFIG_DIR_NAME = BRAND_CONFIG.files.configDir.primary;
export const LEGACY_CONFIG_DIR_NAME = BRAND_CONFIG.files.configDir.legacy;

// Internal Workspace State
export const PRIMARY_STATE_FILE = BRAND_CONFIG.files.state.primary;
export const LEGACY_STATE_FILE = BRAND_CONFIG.files.state.legacy;

export const PRIMARY_ANALYSIS_CACHE_FILE = BRAND_CONFIG.files.analysisCache.primary;
export const LEGACY_ANALYSIS_CACHE_FILE = BRAND_CONFIG.files.analysisCache.legacy;

export const PRIMARY_LOGS_DIR = BRAND_CONFIG.files.logsDir.primary;
export const LEGACY_LOGS_DIR = BRAND_CONFIG.files.logsDir.legacy;

