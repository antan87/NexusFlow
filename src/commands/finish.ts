/**
 * @module commands/finish
 * `nexusflow finish` — closes the loop that `create` opens: commit and push
 * every repo, surface PR links, promote reusable learnings into base knowledge,
 * and optionally remove the workspace once everything is safely pushed.
 */

import chalk from 'chalk';
import { confirm, input, checkbox, select } from '@inquirer/prompts';
import * as path from 'node:path';

import { loadFeatureConfig, deleteWorkspace } from '../core/workspace.js';
import { stopServices } from '../orchestration/runner.js';
import { getWorkspaceStatusReport } from '../core/status.js';
import { finishWorkspace, type RepoFinishReport } from '../core/finish.js';
import { getWorkspaceRepos } from '../utils/multi-git.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import { readWorkspaceKnowledge, parseKnowledgeEntries, promoteKnowledge, type KnowledgeEntryType } from '../core/knowledge.js';
import { BRAND_NAME } from '../core/constants.js';

interface FinishCommandOptions {
  message?: string;
  pr?: boolean; // --no-pr → false
  knowledge?: boolean; // --no-knowledge → false
  cleanup?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

const PROMOTABLE_TYPES: KnowledgeEntryType[] = ['decision', 'gotcha', 'assumption'];

function oneLine(text: string, max = 72): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`;
}

export async function finishCommand(
  workspaceArg: string | undefined,
  options: FinishCommandOptions,
): Promise<void> {
  console.log(chalk.bold.cyan(`\n🏁 ${BRAND_NAME} — Finish Feature\n`));

  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace to finish:');
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  // ── Preflight ────────────────────────────────────────────────────────────
  const preflight = await getWorkspaceStatusReport(workspacePath);
  console.log(chalk.bold('Preflight status:'));
  // Pad the plain text *before* colorizing so ANSI codes don't skew alignment,
  // and size columns to the actual repo/branch names (they can be long).
  const nameW = Math.max(10, ...preflight.repos.map((r) => r.name.length)) + 2;
  const branchW = Math.max(6, ...preflight.repos.map((r) => (r.branch ?? '(detached)').length)) + 2;
  const dirtyW = 12;
  console.log(
    chalk.dim('  ' + 'Repository'.padEnd(nameW) + 'Branch'.padEnd(branchW) + 'Dirty'.padEnd(dirtyW) + 'Unpushed'),
  );
  for (const r of preflight.repos) {
    const branchText = (r.branch ?? '(detached)').padEnd(branchW);
    const branchCol = r.onExpectedBranch ? branchText : chalk.yellow(branchText);
    const dirtyText = (r.dirty ? `${r.changedFiles.length} file(s)` : 'clean').padEnd(dirtyW);
    const dirtyCol = r.dirty ? chalk.yellow(dirtyText) : chalk.green(dirtyText);
    const aheadText = r.ahead === null ? 'never pushed' : String(r.ahead);
    const aheadCol = r.ahead === null || (r.ahead ?? 0) > 0 ? chalk.yellow(aheadText) : chalk.green(aheadText);
    console.log('  ' + r.name.padEnd(nameW) + branchCol + dirtyCol + aheadCol);
  }
  console.log();

  if (options.dryRun) {
    const dirty = preflight.repos.filter((r) => r.dirty && r.onExpectedBranch);
    const toPush = preflight.repos.filter((r) => r.onExpectedBranch && r.remoteUrl && (r.ahead === null || (r.ahead ?? 0) > 0));
    console.log(chalk.yellow('Dry run — no changes will be made.'));
    console.log(`  Would commit: ${dirty.map((r) => r.name).join(', ') || 'nothing'}`);
    console.log(`  Would push:   ${toPush.map((r) => r.name).join(', ') || 'nothing'}`);
    console.log(`  Would offer PR links and knowledge promotion.\n`);
    return;
  }

  // ── Commit message ─────────────────────────────────────────────────────
  let message = options.message;
  const hasDirty = preflight.repos.some((r) => r.dirty && r.onExpectedBranch);
  if (hasDirty && !message) {
    const { promptMultiLineInput } = await import('../utils/prompts.js');
    message = await promptMultiLineInput('commit message for the remaining changes');
    if (!message.trim()) {
      console.log(chalk.yellow('No commit message — leaving uncommitted changes in place.\n'));
      message = undefined;
    }
  }

  // ── Run the finish engine ────────────────────────────────────────────────
  const report = await finishWorkspace(workspacePath, {
    message,
    createPrs: options.pr !== false,
  });

  console.log(chalk.bold('Results:'));
  for (const r of report.repos) {
    console.log(`  ${chalk.bold(r.name)}: ${describeRepo(r)}`);
  }
  console.log();

  const prLinks = report.repos.filter((r) => r.prUrl || r.compareUrl);
  if (prLinks.length > 0) {
    console.log(chalk.bold('Open a PR:'));
    for (const r of prLinks) {
      console.log(`  ${chalk.bold(r.name)}: ${chalk.cyan(r.prUrl ?? r.compareUrl)}`);
    }
    console.log();
  }

  // ── Knowledge promotion ──────────────────────────────────────────────────
  if (options.knowledge !== false && !options.yes) {
    await promoteInteractively(workspacePath);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  if (!report.safeToCleanup) {
    if (options.cleanup) {
      console.log(chalk.yellow('⚠  Not removing the workspace — some repos are still dirty or unpushed:'));
      for (const r of report.repos) {
        if (r.error) console.log(`    - ${r.name}: ${r.error}`);
        else if (r.skipped) console.log(`    - ${r.name}: ${r.skipped}`);
      }
      console.log();
    }
    console.log(chalk.green('✅ Finish complete.\n'));
    return;
  }

  const wantsCleanup = options.cleanup
    ? true
    : options.yes
      ? false
      : await confirm({ message: 'Everything is pushed. Remove this workspace now?', default: false });

  if (wantsCleanup) {
    const confirmed = options.cleanup && !options.yes
      ? await confirm({ message: `Delete workspace "${feature.branchName}"? All worktrees will be force-removed.`, default: false })
      : true;
    if (confirmed) {
      try {
        try {
          await stopServices(workspacePath);
        } catch {
          // Non-fatal if no services were running or PM2 is not active
        }
        await deleteWorkspace(workspacePath);
        console.log(chalk.green(`\n✅ Removed workspace ${feature.branchName}.\n`));
      } catch (error) {
        console.error(chalk.red(`✖ ${error instanceof Error ? error.message : String(error)}`));
      }
      return;
    }
  }

  console.log(chalk.green('✅ Finish complete.\n'));
}

/** One-line description of a repo's finish outcome. */
function describeRepo(r: RepoFinishReport): string {
  if (r.error) return chalk.red(`✖ ${r.error}`);
  if (r.skipped) return chalk.yellow(`skipped (${r.skipped})`);
  const parts: string[] = [];
  if (r.committed) parts.push(`committed ${r.commitHash ?? ''}`.trim());
  if (r.pushed) parts.push('pushed');
  if (parts.length === 0) parts.push('nothing to do');
  return chalk.green(`✔ ${parts.join(', ')}`);
}

/** Interactive knowledge merge-back into per-repo base knowledge. */
async function promoteInteractively(workspacePath: string): Promise<void> {
  const content = await readWorkspaceKnowledge(workspacePath);
  if (!content) return;

  const promotable = parseKnowledgeEntries(content).filter((e) => e.type && PROMOTABLE_TYPES.includes(e.type));
  if (promotable.length === 0) return;

  const wants = await confirm({
    message: `Promote reusable learnings into repo base knowledge? (${promotable.length} available)`,
    default: false,
  });
  if (!wants) return;

  const repos = await getWorkspaceRepos(workspacePath);
  const repoName = await select({
    message: "Promote into which repository's base knowledge?",
    choices: repos.map((r) => ({ name: r.name, value: r.name })),
  });

  const indices = await checkbox({
    message: 'Select learnings to promote:',
    choices: promotable.map((e, i) => ({ name: `[${e.type}] ${oneLine(e.text)}`, value: i })),
  });
  const selected = indices.map((i) => promotable[i]);
  if (selected.length === 0) return;

  const move = await confirm({ message: 'Remove the promoted entries from the workspace knowledge file?', default: false });
  const result = await promoteKnowledge(workspacePath, { repoName, entries: selected, mode: move ? 'move' : 'copy' });
  console.log(chalk.green(`  ✔ Promoted ${result.promotedCount} learning(s) to ${repoName} base knowledge.`));
}
