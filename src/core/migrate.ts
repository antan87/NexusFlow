/**
 * @module core/migrate
 * Systematic migration of legacy NexusFlow workspaces and global configurations to ContextSpace.
 */

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BRAND_CONFIG } from './brand-config.js';
import { loadFeatureConfig } from './workspace.js';
import { refreshWorkspace } from './refresh.js';

export interface FileMigrationResult {
  from: string;
  to: string;
  status: 'renamed' | 'copied' | 'skipped' | 'failed';
  error?: string;
}

export interface WorkspaceMigrationReport {
  workspacePath: string;
  featureId: string;
  isLegacy: boolean;
  renamedFiles: FileMigrationResult[];
  updatedSentinels: string[];
  refreshedContext: boolean;
  warnings: string[];
  dryRun: boolean;
}

export interface GlobalMigrationReport {
  migratedConfig: boolean;
  migratedProjects: boolean;
  migratedWorkflows: number;
  sourceDir: string;
  targetDir: string;
  dryRun: boolean;
}

/**
 * Migration mappings for known legacy files within a workspace.
 */
const WORKSPACE_FILE_MAPPINGS: Array<{ legacy: string; primary: string }> = [
  { legacy: BRAND_CONFIG.files.manifest.legacy, primary: BRAND_CONFIG.files.manifest.primary },
  { legacy: BRAND_CONFIG.files.lock.legacy, primary: BRAND_CONFIG.files.lock.primary },
  { legacy: BRAND_CONFIG.files.knowledge.legacy, primary: BRAND_CONFIG.files.knowledge.primary },
  { legacy: BRAND_CONFIG.files.plan.legacy, primary: BRAND_CONFIG.files.plan.primary },
  { legacy: BRAND_CONFIG.files.handoff.legacy, primary: BRAND_CONFIG.files.handoff.primary },
  { legacy: BRAND_CONFIG.files.overview.legacy, primary: BRAND_CONFIG.files.overview.primary },
  { legacy: BRAND_CONFIG.files.state.legacy, primary: BRAND_CONFIG.files.state.primary },
  { legacy: BRAND_CONFIG.files.runningState.legacy, primary: BRAND_CONFIG.files.runningState.primary },
  { legacy: BRAND_CONFIG.files.analysisCache.legacy, primary: BRAND_CONFIG.files.analysisCache.primary },
  { legacy: BRAND_CONFIG.files.cursorRule.legacy, primary: BRAND_CONFIG.files.cursorRule.primary },
];

/**
 * Checks if a workspace contains legacy NexusFlow files.
 */
export async function isLegacyWorkspace(workspacePath: string): Promise<boolean> {
  const legacyManifest = path.join(workspacePath, BRAND_CONFIG.files.manifest.legacy);
  const primaryManifest = path.join(workspacePath, BRAND_CONFIG.files.manifest.primary);

  if (existsSync(legacyManifest) && !existsSync(primaryManifest)) {
    return true;
  }

  for (const mapping of WORKSPACE_FILE_MAPPINGS) {
    if (existsSync(path.join(workspacePath, mapping.legacy))) {
      return true;
    }
  }

  return false;
}

/**
 * Migrates a single workspace from NexusFlow to ContextSpace.
 */
export async function migrateWorkspace(
  workspacePath: string,
  options: { dryRun?: boolean; refresh?: boolean } = {},
): Promise<WorkspaceMigrationReport> {
  const dryRun = options.dryRun ?? false;
  const doRefresh = options.refresh ?? true;
  const resolvedPath = path.resolve(workspacePath);

  const feature = await loadFeatureConfig(resolvedPath);
  const featureId = feature?.id || feature?.branchName || path.basename(resolvedPath);

  const report: WorkspaceMigrationReport = {
    workspacePath: resolvedPath,
    featureId,
    isLegacy: false,
    renamedFiles: [],
    updatedSentinels: [],
    refreshedContext: false,
    warnings: [],
    dryRun,
  };

  // 1. Rename files from legacy to primary
  for (const mapping of WORKSPACE_FILE_MAPPINGS) {
    const legacyPath = path.join(resolvedPath, mapping.legacy);
    const primaryPath = path.join(resolvedPath, mapping.primary);

    if (existsSync(legacyPath)) {
      report.isLegacy = true;
      if (existsSync(primaryPath)) {
        report.renamedFiles.push({
          from: mapping.legacy,
          to: mapping.primary,
          status: 'skipped',
          error: 'Primary target already exists',
        });
      } else {
        if (!dryRun) {
          try {
            await fs.mkdir(path.dirname(primaryPath), { recursive: true });
            await fs.rename(legacyPath, primaryPath);
            report.renamedFiles.push({
              from: mapping.legacy,
              to: mapping.primary,
              status: 'renamed',
            });
          } catch (err: any) {
            report.renamedFiles.push({
              from: mapping.legacy,
              to: mapping.primary,
              status: 'failed',
              error: err.message,
            });
          }
        } else {
          report.renamedFiles.push({
            from: mapping.legacy,
            to: mapping.primary,
            status: 'renamed',
          });
        }
      }
    }
  }

  // 2. Migrate legacy directories (e.g., .nexusflow/ -> .contextspace/)
  const legacyDir = path.join(resolvedPath, BRAND_CONFIG.files.configDir.legacy);
  const primaryDir = path.join(resolvedPath, BRAND_CONFIG.files.configDir.primary);
  if (existsSync(legacyDir) && !existsSync(primaryDir)) {
    report.isLegacy = true;
    if (!dryRun) {
      try {
        await fs.rename(legacyDir, primaryDir);
        report.renamedFiles.push({
          from: BRAND_CONFIG.files.configDir.legacy,
          to: BRAND_CONFIG.files.configDir.primary,
          status: 'renamed',
        });
      } catch (err: any) {
        report.renamedFiles.push({
          from: BRAND_CONFIG.files.configDir.legacy,
          to: BRAND_CONFIG.files.configDir.primary,
          status: 'failed',
          error: err.message,
        });
      }
    } else {
      report.renamedFiles.push({
        from: BRAND_CONFIG.files.configDir.legacy,
        to: BRAND_CONFIG.files.configDir.primary,
        status: 'renamed',
      });
    }
  }

  // 3. Update sentinels in markdown files
  const markdownFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'WORKSPACE.md',
    BRAND_CONFIG.files.knowledge.primary,
    BRAND_CONFIG.files.plan.primary,
    BRAND_CONFIG.files.handoff.primary,
  ];

  for (const rel of markdownFiles) {
    const filePath = path.join(resolvedPath, rel);
    try {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err: any) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      let updated = content;

      // Update freshness sentinel tags
      updated = updated.replace(/NEXUSFLOW:FRESHNESS:START/g, 'CONTEXTSPACE:FRESHNESS:START');
      updated = updated.replace(/NEXUSFLOW:FRESHNESS:END/g, 'CONTEXTSPACE:FRESHNESS:END');
      updated = updated.replace(/nexusflow refresh/g, 'ctxspace refresh');
      updated = updated.replace(/nexusflow knowledge/g, 'ctxspace knowledge');
      updated = updated.replace(/nexusflow finish/g, 'ctxspace finish');
      updated = updated.replace(/nexusflow/g, 'contextspace');
      updated = updated.replace(/NexusFlow/g, 'ContextSpace');

      if (updated !== content) {
        if (!dryRun) {
          await fs.writeFile(filePath, updated, 'utf-8');
        }
        report.updatedSentinels.push(rel);
      }
    } catch (e: any) {
      report.warnings.push(`Failed to update markdown sentinels in ${rel}: ${e.message}`);
    }
  }

  // 4. Update .gitignore
  const gitignorePath = path.join(resolvedPath, '.gitignore');
  try {
    const gitignore = await fs.readFile(gitignorePath, 'utf-8');
    const lines = gitignore.split('\n');
    const needed = [
      'contextspace.json',
      'contextspace.lock',
      'contextspace-*.md',
      '.contextspace',
      '.contextspace*',
    ];
    const missing = needed.filter((n) => !lines.includes(n));
    if (missing.length > 0) {
      if (!dryRun) {
        const appended = gitignore.trimEnd() + '\n\n# ContextSpace\n' + missing.join('\n') + '\n';
        await fs.writeFile(gitignorePath, appended, 'utf-8');
      }
      report.updatedSentinels.push('.gitignore');
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      report.warnings.push(`Failed to update .gitignore: ${err.message}`);
    }
  }

  // 5. Trigger refresh to ensure all context files match
  if (!dryRun && doRefresh) {
    try {
      await refreshWorkspace(resolvedPath, { force: true });
      report.refreshedContext = true;
    } catch (e: any) {
      report.warnings.push(`Workspace refreshed with warning: ${e.message}`);
    }
  }

  return report;
}

/**
 * Migrates global configuration and projects registry (~/.nexusflow -> ~/.contextspace).
 */
export async function migrateGlobalConfig(options: { dryRun?: boolean } = {}): Promise<GlobalMigrationReport> {
  const dryRun = options.dryRun ?? false;
  const legacyHome = path.join(os.homedir(), BRAND_CONFIG.files.configDir.legacy);
  const primaryHome = path.join(os.homedir(), BRAND_CONFIG.files.configDir.primary);

  const report: GlobalMigrationReport = {
    migratedConfig: false,
    migratedProjects: false,
    migratedWorkflows: 0,
    sourceDir: legacyHome,
    targetDir: primaryHome,
    dryRun,
  };

  if (!existsSync(legacyHome)) {
    return report;
  }

  if (!dryRun) {
    await fs.mkdir(primaryHome, { recursive: true });
  }

  // 1. config.json
  const legacyConfig = path.join(legacyHome, 'config.json');
  const primaryConfig = path.join(primaryHome, 'config.json');
  if (existsSync(legacyConfig) && !existsSync(primaryConfig)) {
    if (!dryRun) {
      await fs.copyFile(legacyConfig, primaryConfig);
    }
    report.migratedConfig = true;
  }

  // 2. projects.json
  const legacyProjects = path.join(legacyHome, 'projects.json');
  const primaryProjects = path.join(primaryHome, 'projects.json');
  if (existsSync(legacyProjects) && !existsSync(primaryProjects)) {
    if (!dryRun) {
      await fs.copyFile(legacyProjects, primaryProjects);
    }
    report.migratedProjects = true;
  }

  // 3. workflows/
  const legacyWorkflows = path.join(legacyHome, 'workflows');
  const primaryWorkflows = path.join(primaryHome, 'workflows');
  if (existsSync(legacyWorkflows)) {
    try {
      const files = await fs.readdir(legacyWorkflows);
      if (!dryRun) {
        await fs.mkdir(primaryWorkflows, { recursive: true });
      }
      for (const file of files) {
        const src = path.join(legacyWorkflows, file);
        const dest = path.join(primaryWorkflows, file);
        if (!existsSync(dest)) {
          if (!dryRun) {
            await fs.copyFile(src, dest);
          }
          report.migratedWorkflows++;
        }
      }
    } catch {}
  }

  return report;
}
