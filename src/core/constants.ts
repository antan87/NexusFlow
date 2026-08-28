/**
 * @module core/constants
 * Centralized constants for ContextSpace file names, legacy compatibility fallbacks,
 * environment variables, and brand identifiers.
 */

export const BRAND_NAME = 'ContextSpace';
export const CLI_NAME = 'ctxspace';
export const CLI_ALIASES = ['contextspace', 'cs', 'nexusflow'] as const;
export const MCP_SERVER_NAME = 'contextspace-mcp';
export const LEGACY_MCP_SERVER_NAME = 'nexusflow-mcp';

// Workspace Manifests
export const PRIMARY_MANIFEST_FILE = 'contextspace.json';
export const LEGACY_MANIFEST_FILE = 'nexusflow.json';

// Integrity Lockfiles
export const PRIMARY_LOCK_FILE = 'contextspace.lock';
export const LEGACY_LOCK_FILE = 'nexusflow.lock';

// Durable Workspace Memory & Generated Views
export const PRIMARY_KNOWLEDGE_FILE = 'contextspace-knowledge.md';
export const LEGACY_KNOWLEDGE_FILE = 'nexusflow-knowledge.md';

export const PRIMARY_PLAN_FILE = 'contextspace-plan.md';
export const LEGACY_PLAN_FILE = 'nexusflow-plan.md';

export const PRIMARY_OVERVIEW_FILE = 'contextspace-overview.md';
export const LEGACY_OVERVIEW_FILE = 'nexusflow-overview.md';

export const PRIMARY_HANDOFF_FILE = 'contextspace-handoff.md';
export const LEGACY_HANDOFF_FILE = 'nexusflow-handoff.md';

// IDE Rules
export const PRIMARY_CURSOR_RULE_FILE = '.cursor/rules/contextspace.mdc';
export const LEGACY_CURSOR_RULE_FILE = '.cursor/rules/nexusflow.mdc';

// User Config Directory
export const PRIMARY_CONFIG_DIR_NAME = '.contextspace';
export const LEGACY_CONFIG_DIR_NAME = '.nexusflow';

// Internal Workspace State
export const PRIMARY_STATE_FILE = '.contextspace-state.json';
export const LEGACY_STATE_FILE = '.nexusflow-state.json';

export const PRIMARY_ANALYSIS_CACHE_FILE = '.contextspace-analysis-cache.json';
export const LEGACY_ANALYSIS_CACHE_FILE = '.nexusflow-analysis-cache.json';

export const PRIMARY_LOGS_DIR = '.contextspace-logs';
export const LEGACY_LOGS_DIR = '.nexusflow-logs';
