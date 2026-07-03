import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig, resolveRepoInfos } from '../core/workspace.js';
import { getWorkspaceRepos, getRepoStatus } from '../utils/multi-git.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { buildDependencyGraph } from '../generators/plan-generator.js';

/**
 * Runs the handoff command.
 * Auto-detects workspace from CWD or prompts user to select one.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 */
export async function handoffCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n🤝 NexusFlow — Handoff Bundle\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists.'));
    return;
  }

  const allRepos = await resolveRepoInfos(feature.repos);

  console.log(chalk.cyan('Retrieving repository statuses and running analysis...'));
  const { analysis } = await analyzeAllReposCached(allRepos, workspacePath);

  const reposStatusInfo = await Promise.all(
    allRepos.map(async (repo) => {
      const status = await getRepoStatus(repo.path);
      const branch = await getRepoBranch(repo.path);
      const repoAnalysis = analysis.get(repo.path);
      
      const suggestedFiles = getSuggestedFiles(repo.path, status.changedFiles, repoAnalysis);
      const testCommand = getTestCommand(repo.path, repoAnalysis);

      return {
        name: repo.name,
        path: repo.path,
        branch,
        dirtySummary: status.summary,
        isDirty: status.hasChanges,
        changedFiles: status.changedFiles,
        suggestedFiles,
        testCommand,
      };
    })
  );

  // Parse knowledge from nexusflow-knowledge.md if it exists
  const knowledgePath = path.join(workspacePath, 'nexusflow-knowledge.md');
  let extractedGotchas = '_None recorded yet._';
  let extractedDecisions = '_None recorded yet._';
  let extractedQuestions = '_None recorded yet._';

  try {
    const knowledgeContent = await fs.readFile(knowledgePath, 'utf-8');
    extractedGotchas = extractSection(knowledgeContent, ['Known Gotchas', 'Discovered Gotchas & Watch-outs', 'Discovered Gotchas']);
    extractedDecisions = extractSection(knowledgeContent, 'Architecture Decisions');
    extractedQuestions = extractSection(knowledgeContent, ['Clarifying Questions for the User', 'Clarifying Questions']);
  } catch {}

  // Build dependency description
  let depGraphDescription = '';
  try {
    const graph = buildDependencyGraph(analysis, allRepos);
    const relations: string[] = [];
    for (const [name, node] of graph) {
      if (node.dependsOn.length > 0) {
        relations.push(`- **${name}** depends on: ${node.dependsOn.map(d => `\`${d}\``).join(', ')}`);
      }
    }
    depGraphDescription = relations.length > 0 ? relations.join('\n') : '_No inter-repo package dependencies detected._';
  } catch {
    depGraphDescription = '_Error generating dependency graph._';
  }

  const timestamp = new Date().toISOString();
  
  // Format handoff bundle
  const md: string[] = [];
  md.push(`# NexusFlow Handoff Bundle — ${feature.branchName}`);
  md.push('');
  md.push(`> **Workspace Path:** \`${workspacePath}\``);
  md.push(`> **Current Branch:** \`${feature.branchName}\``);
  md.push(`> **Generated:** ${timestamp} (UTC)`);
  md.push('> **Instruction:** Read this handoff bundle first to resume context immediately.');
  md.push('');
  md.push('## 📋 Repository Statuses');
  md.push('');
  md.push('| Repository | Branch | Git Status | Suggested Files to Read |');
  md.push('|---|---|---|---|');

  for (const r of reposStatusInfo) {
    const filesList = r.suggestedFiles.map(f => `\`${f}\``).join(', ') || '—';
    const statusText = r.isDirty ? `⚠️ ${r.dirtySummary}` : '✅ Clean';
    md.push(`| **${r.name}** | \`${r.branch}\` | ${statusText} | ${filesList} |`);
  }
  md.push('');

  md.push('## 🧪 Verification & Run Commands');
  md.push('');
  for (const r of reposStatusInfo) {
    md.push(`- **${r.name}**: \`${r.testCommand}\``);
  }
  md.push('');

  md.push('## 🏗️ Inter-Repo Package Graph');
  md.push('');
  md.push(depGraphDescription);
  md.push('');

  md.push('## 📝 Active Session Context (from nexusflow-knowledge.md)');
  md.push('');
  md.push('### Open Gotchas & Blockers');
  md.push(extractedGotchas);
  md.push('');
  md.push('### Recent Architecture Decisions');
  md.push(extractedDecisions);
  md.push('');
  md.push('### Outstanding Clarifying Questions');
  md.push(extractedQuestions);
  md.push('');

  const handoffFilePath = path.join(workspacePath, 'nexusflow-handoff.md');
  await fs.writeFile(handoffFilePath, md.join('\n'), 'utf-8');

  console.log(chalk.green(`\n✅ Generated handoff bundle: ${chalk.bold('nexusflow-handoff.md')}`));
  console.log(chalk.dim(`  Path: ${handoffFilePath}\n`));
}

/**
 * Gets the current branch name of a repository.
 */
async function getRepoBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Determines a candidate list of files to read first.
 */
function getSuggestedFiles(repoPath: string, dirtyFiles: string[], analysis?: any): string[] {
  if (dirtyFiles.length > 0) {
    return dirtyFiles.slice(0, 3).map(f => f.replace(/\\/g, '/'));
  }
  
  const suggestions: string[] = [];
  if (analysis && analysis.runConfig && analysis.runConfig.entryPoints) {
    for (const ep of analysis.runConfig.entryPoints) {
      if (ep.projectPath && !suggestions.includes(ep.projectPath)) {
        suggestions.push(ep.projectPath);
      }
    }
  }

  suggestions.push('README.md');
  return suggestions.slice(0, 3);
}

/**
 * Resolves correct test command.
 */
function getTestCommand(repoPath: string, analysis?: any): string {
  if (analysis) {
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
  }
  return 'npm test'; // fallback
}

/**
 * Extracts a specific section from the knowledge file. Accepts one or more
 * header aliases so it tolerates both the workspace doc's headers and the
 * base-knowledge template's differently-worded equivalents.
 */
function extractSection(content: string, header: string | string[]): string {
  const headers = Array.isArray(header) ? header : [header];
  const lines = content.split('\n');
  const index = lines.findIndex(l =>
    headers.some(h => l.trim().startsWith(`## ${h}`)),
  );
  if (index === -1) return '_None recorded yet._';

  const resultLines: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith('##')) break;
    resultLines.push(lines[i]!);
  }
  
  const sectionContent = resultLines.join('\n').trim();
  if (
    !sectionContent ||
    sectionContent.includes('No assumptions recorded yet') ||
    sectionContent.includes('No open questions recorded yet') ||
    sectionContent.includes('No decisions recorded yet') ||
    sectionContent.includes('No gotchas recorded yet') ||
    sectionContent.includes('AI assistant to populate')
  ) {
    return '_None recorded yet._';
  }
  return sectionContent;
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
    message: 'Select a workspace:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
