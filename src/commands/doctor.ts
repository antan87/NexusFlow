import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig, resolveRepoInfos } from '../core/workspace.js';
import { getRepoStatus } from '../utils/multi-git.js';
import { workspaceFileExists, baseFileExists } from '../core/storage.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { globby } from 'globby';
import { isOllamaModelAvailable, getOpenAiCompatibleUrl } from '../utils/local-ai.js';

/**
 * Runs the doctor command to diagnose workspace state.
 *
 * @param workspaceArg - Optional workspace path.
 */
export async function doctorCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n🩺 NexusFlow — Workspace Doctor\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists.'));
    return;
  }

  const allRepos = await resolveRepoInfos(feature.repos);

  console.log(chalk.cyan('Running diagnostics...\n'));

  const warnings: string[] = [];
  const errors: string[] = [];

  // ── 1. Worktree Paths Check ──────────────────────────────────────────
  console.log(chalk.bold('📁 Worktree Paths:'));
  let worktreeErrors = false;
  for (const repo of allRepos) {
    try {
      const stat = await fs.stat(repo.path);
      if (!stat.isDirectory()) {
        errors.push(`Worktree path for "${repo.name}" is not a directory.`);
        console.log(`  ${chalk.red('✖')} ${repo.name}: Path is not a directory`);
        worktreeErrors = true;
      } else {
        console.log(`  ${chalk.green('✔')} ${repo.name}: Directory exists`);
      }
    } catch {
      errors.push(`Worktree path for "${repo.name}" does not exist: ${repo.path}`);
      console.log(`  ${chalk.red('✖')} ${repo.name}: Path does not exist`);
      worktreeErrors = true;
    }
  }
  console.log();

  if (worktreeErrors) {
    console.error(chalk.red('✖ Worktree errors detected. Cannot complete diagnostics.\n'));
    return;
  }

  // ── 2. Run Analysis for detailed checks ────────────────────────────────
  const { analysis } = await analyzeAllReposCached(allRepos, workspacePath);
  console.log();

  // ── 3. Branch & Git Status Checks ──────────────────────────────────────
  console.log(chalk.bold('🌿 Branch Alignment & Git Status:'));
  for (const repo of allRepos) {
    let branch = 'unknown';
    try {
      const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.path });
      branch = stdout.trim();
    } catch {}

    if (branch !== feature.branchName) {
      warnings.push(`Repository "${repo.name}" is checked out on branch "${branch}", but workspace branch is "${feature.branchName}".`);
      console.log(`  ${chalk.yellow('⚠')} ${repo.name}: Branch mismatch (${chalk.bold(branch)} vs expected ${chalk.bold(feature.branchName)})`);
    } else {
      console.log(`  ${chalk.green('✔')} ${repo.name}: Aligned on branch "${branch}"`);
    }

    const status = await getRepoStatus(repo.path);
    if (status.hasChanges) {
      warnings.push(`Repository "${repo.name}" has uncommitted changes.`);
      console.log(`    ${chalk.dim(`↳ Has uncommitted changes (${status.summary})`)}`);
    }
  }
  console.log();

  // ── 4. Package Registry, Local Feeds, and Temporary Local Versions ─────
  console.log(chalk.bold('📦 Local Package Setup & Reference Versioning:'));
  let hasCsharp = false;
  let hasNode = false;

  for (const repo of allRepos) {
    const a = analysis.get(repo.path);
    if (!a) continue;

    if (a.techStack.languages.includes('csharp')) hasCsharp = true;
    if (a.techStack.languages.includes('typescript') || a.techStack.languages.includes('javascript')) hasNode = true;

    // Check for temporary/uncommitted versions in C# csproj
    if (a.techStack.languages.includes('csharp')) {
      try {
        const csprojs = await globby('**/*.csproj', {
          cwd: repo.path,
          absolute: true,
          ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
        });

        for (const csproj of csprojs) {
          const content = await fs.readFile(csproj, 'utf-8');
          if (content.toLowerCase().includes('-local') || content.toLowerCase().includes('-dev')) {
            warnings.push(`Temporary package version (e.g. ending in "-local" or "-dev") found in "${path.basename(csproj)}".`);
            console.log(`  ${chalk.yellow('⚠')} ${repo.name}: Temporary local package version found in "${path.basename(csproj)}"`);
          }
        }
      } catch {}

      // NuGet local feed checks: check if any local NuGet source is defined in local NuGet.configs
      if (a.nugetFeeds && a.nugetFeeds.length === 0) {
        // Find if there are NuGet.config files
        try {
          const nugetConfigs = await globby('**/NuGet.config', {
            cwd: repo.path,
            ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
          });
          if (nugetConfigs.length === 0) {
            warnings.push(`Repository "${repo.name}" does not have a NuGet.config. It might not resolve local package dependencies.`);
            console.log(`  ${chalk.yellow('⚠')} ${repo.name}: No NuGet.config found (needed to configure local package feeds)`);
          }
        } catch {}
      }
    }

    // Check for relative path/file: dependencies in Node package.json
    if (a.techStack.languages.includes('typescript') || a.techStack.languages.includes('javascript')) {
      try {
        const pjs = await globby('**/package.json', {
          cwd: repo.path,
          absolute: true,
          ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
        });

        for (const pj of pjs) {
          const content = await fs.readFile(pj, 'utf-8');
          if (content.includes('"file:') || content.includes('"link:')) {
            warnings.push(`Temporary package link/file reference (e.g., "file:../") found in "${path.basename(pj)}".`);
            console.log(`  ${chalk.yellow('⚠')} ${repo.name}: Temporary local dependency reference ("file:" or "link:") found in "${path.basename(pj)}"`);
          }
        }
      } catch {}
    }
  }

  if (hasCsharp || hasNode) {
    console.log(`  ${chalk.green('✔')} Local registry feeds/link validation completed.`);
  } else {
    console.log(`  ${chalk.dim('No C# or Node.js repositories to validate.')}`);
  }
  console.log();

  // ── 5. Test Commands & Fallbacks ───────────────────────────────────────
  console.log(chalk.bold('🧪 Test Commands:'));
  for (const repo of allRepos) {
    const a = analysis.get(repo.path);
    if (!a) continue;

    const testCommand = getTestCommand(a);
    if (testCommand === 'npm test' && !a.techStack.languages.includes('typescript') && !a.techStack.languages.includes('javascript')) {
      warnings.push(`Repository "${repo.name}" fell back to default test command "npm test".`);
      console.log(`  ${chalk.yellow('⚠')} ${repo.name}: Using default fallback test command "npm test"`);
    } else {
      console.log(`  ${chalk.green('✔')} ${repo.name}: Test command is "${testCommand}"`);
    }
  }
  console.log();

  // ── 6. Missing Core Files ──────────────────────────────────────────────
  // Checks go through the storage adapter so they hold for non-local providers
  // (vault/obsidian) where these artifacts don't live at the workspace root.
  console.log(chalk.bold('📄 Core Artifacts:'));
  const featureId = path.basename(workspacePath);
  const coreFiles: Array<{ name: string; exists: () => Promise<boolean> }> = [
    { name: 'WORKSPACE.md', exists: () => workspaceFileExists(workspacePath, featureId, 'WORKSPACE.md') },
    { name: 'nexusflow-knowledge.md', exists: () => workspaceFileExists(workspacePath, featureId, 'nexusflow-knowledge.md') },
    { name: 'nexusflow-plan.md', exists: () => workspaceFileExists(workspacePath, featureId, 'nexusflow-plan.md') },
  ];

  // Per-repo maps are base-namespace files.
  for (const repo of allRepos) {
    const name = `nexusflow-map-${repo.name}.md`;
    coreFiles.push({ name, exists: () => baseFileExists(workspacePath, repo.name, name) });
  }

  for (const file of coreFiles) {
    if (await file.exists()) {
      console.log(`  ${chalk.green('✔')} ${file.name} exists`);
    } else {
      warnings.push(`Missing core workspace artifact: "${file.name}".`);
      console.log(`  ${chalk.yellow('⚠')} ${file.name} is missing`);
    }
  }

  // Check .code-workspace file exists (required for VS Code SCM to discover worktrees)
  const workspaceName = path.basename(workspacePath);
  const codeWorkspacePath = path.join(workspacePath, `${workspaceName}.code-workspace`);
  try {
    await fs.access(codeWorkspacePath);
    console.log(`  ${chalk.green('✔')} ${workspaceName}.code-workspace exists`);
  } catch {
    warnings.push(
      `Missing ${workspaceName}.code-workspace. VS Code SCM will not show changes inside repo sub-folders. Run \`nexusflow refresh\` to regenerate it.`
    );
    console.log(`  ${chalk.yellow('⚠')} ${workspaceName}.code-workspace is missing`);
  }

  // Check VS Code Settings for search.useIgnoreFiles: false
  const vscodeSettingsPath = path.join(workspacePath, '.vscode', 'settings.json');
  try {
    const content = await fs.readFile(vscodeSettingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed['search.useIgnoreFiles'] === false) {
      console.log(`  ${chalk.green('✔')} .vscode/settings.json is configured correctly (search.useIgnoreFiles: false)`);
    } else {
      warnings.push('.vscode/settings.json search.useIgnoreFiles is not set to false. VS Code global search may ignore repository files.');
      console.log(`  ${chalk.yellow('⚠')} .vscode/settings.json: search.useIgnoreFiles is not set to false`);
    }
  } catch {
    warnings.push('Missing .vscode/settings.json. VS Code search might not work properly inside sub-repos.');
    console.log(`  ${chalk.yellow('⚠')} .vscode/settings.json is missing or invalid`);
  }
  console.log();

  // ── 7. Local AI Agent Connection Check ─────────────────────────────────
  console.log(chalk.bold('🤖 Local AI Agent:'));
  const config = await loadConfig();
  if (config.localLlm?.enabled) {
    const { provider, endpoint, model } = config.localLlm;
    console.log(`  Provider: ${provider}`);
    console.log(`  Endpoint: ${endpoint}`);
    console.log(`  Model: ${model}`);

    try {
      const cleanEndpoint = endpoint.replace(/\/$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        if (provider === 'ollama') {
          const res = await fetch(`${cleanEndpoint}/api/tags`, { signal: controller.signal });
          if (!res.ok) {
            throw new Error(`Ollama responded with status ${res.status}`);
          }
          const data: any = await res.json();
          const models = data?.models || [];
          const isModelLoaded = isOllamaModelAvailable(models, model);

          if (isModelLoaded) {
            console.log(`  ${chalk.green('✔')} Ollama service is active and model "${model}" is ready`);
          } else {
            const availableList = models.map((m: any) => m.name).join(', ') || 'none';
            warnings.push(`Local model "${model}" is not pulled in Ollama. Available: [${availableList}]. Run "ollama pull ${model}" to install it.`);
            console.log(`  ${chalk.yellow('⚠')} Ollama service is active, but model "${model}" is not pulled`);
          }
        } else {
          // OpenAI-compatible endpoint ping
          const testUrl = getOpenAiCompatibleUrl(cleanEndpoint, '/v1/models');
          const res = await fetch(testUrl, { signal: controller.signal });
          if (!res.ok) {
            throw new Error(`OpenAI-compatible server responded with status ${res.status}`);
          }
          console.log(`  ${chalk.green('✔')} OpenAI-compatible server at "${endpoint}" is active`);
        }
      } catch (e: any) {
        const errorMsg = e.name === 'AbortError' ? 'Request timed out after 5 seconds' : e.message;
        throw new Error(errorMsg);
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      warnings.push(`Local LLM server at "${endpoint}" is offline or unreachable: ${e.message}`);
      console.log(`  ${chalk.yellow('⚠')} Local LLM server is offline or unreachable (${e.message})`);
    }
  } else {
    console.log(`  ${chalk.dim('Local AI agent is disabled in config.')}`);
  }
  console.log();

  // ── Summary Report ────────────────────────────────────────────────────
  console.log(chalk.bold('📊 Diagnostic Summary:'));
  if (errors.length === 0 && warnings.length === 0) {
    console.log(chalk.bold.green('  ✔ All checks passed! Workspace is healthy.\n'));
  } else {
    if (errors.length > 0) {
      console.log(chalk.bold.red(`  ✖ ${errors.length} error(s) found. Fix them before proceeding.`));
      for (const err of errors) console.log(`    - ${err}`);
    }
    if (warnings.length > 0) {
      console.log(chalk.bold.yellow(`  ⚠ ${warnings.length} warning(s) found.`));
      for (const warn of warnings) console.log(`    - ${warn}`);
    }
    console.log();
  }
}

/**
 * Resolves correct test command candidate.
 */
function getTestCommand(analysis: any): string {
  if (analysis.techStack.languages.includes('csharp')) {
    return 'dotnet test';
  }
  if (analysis.techStack.languages.includes('typescript') || analysis.techStack.languages.includes('javascript')) {
    return 'npm test';
  }
  if (analysis.techStack.languages.includes('python')) {
    return 'pytest';
  }
  if (analysis.techStack.languages.includes('go')) {
    return 'go test ./...';
  }
  return 'npm test'; // fallback
}

/**
 * Resolves a workspace path.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) {
    const absolutePath = path.resolve(workspaceArg);
    try {
      await fs.access(path.join(absolutePath, 'nexusflow.json'));
      return absolutePath;
    } catch {
      console.error(chalk.red(`✖ Invalid workspace: No nexusflow.json found at ${absolutePath}`));
      return null;
    }
  }

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return cwdFeature.workspacePath;

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace to diagnose:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
