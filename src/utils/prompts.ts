/**
 * @module utils/prompts
 * Interactive CLI prompts for NexusFlow using @inquirer/prompts.
 */

import { input, checkbox, confirm, select, search } from '@inquirer/prompts';
import chalk from 'chalk';

import type { AIAssistant, DetectedAI, DetectedEditor, RepoInfo } from '../types.js';
import { isValidBranchName } from './git.js';
import type { WorkflowTemplate } from './workflows.js';

/**
 * Prompts the user for a feature branch name.
 */
export async function promptBranchName(): Promise<string> {
  const branchName = await input({
    message: 'Feature branch name:',
    validate: (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return 'Branch name cannot be empty';
      if (/\s/.test(trimmed)) return 'Branch name cannot contain spaces';
      // Reject git-illegal names up front so worktree creation doesn't fail
      // deep inside createWorkspace after the workspace dir already exists.
      if (!isValidBranchName(trimmed)) return 'Not a valid git branch name';
      return true;
    },
  });
  return branchName.trim();
}

/**
 * Prompts the user for a feature description.
 * Accepts plain text or a path to a file.
 */
export async function promptDescription(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');

  const descInput = await input({
    message: 'Describe the feature (or paste a path to a .md/.txt file):',
    validate: (value: string) => {
      if (!value.trim()) return 'Description cannot be empty';
      return true;
    },
  });

  const trimmed = descInput.trim();

  // Check if it's a file path
  if (existsSync(trimmed)) {
    try {
      const content = await readFile(trimmed, 'utf-8');
      console.log(chalk.dim(`  Read description from ${trimmed}`));
      return content;
    } catch {
      // Fall through to use as plain text
    }
  }

  return trimmed;
}

/**
 * Prompts the user to select repos from a list of discovered repos.
 * Supports searching/filtering by term, viewing all, and incremental selection.
 */
export async function promptSelectRepos(repos: RepoInfo[]): Promise<RepoInfo[]> {
  if (repos.length === 0) {
    return [];
  }

  const selectedPaths = new Set<string>();

  // If there are only a few repos (e.g. <= 10), we can just show a checkbox prompt directly to save time
  if (repos.length <= 10) {
    const toggled = await checkbox({
      message: 'Select repositories to include in workspace:',
      choices: repos.map((repo) => ({
        name: `${repo.name} ${chalk.dim(`(${repo.path})`)}`,
        value: repo.path,
        checked: false,
      })),
    });
    return repos.filter((r) => toggled.includes(r.path));
  }

  // Otherwise, use a loop with the search prompt to make it extremely easy to filter and toggle selection
  while (true) {
    console.log(chalk.bold(`\n📁 Selected Repositories (${selectedPaths.size}/${repos.length}):`));
    if (selectedPaths.size === 0) {
      console.log(chalk.dim('  (None selected yet)'));
    } else {
      repos.forEach((r) => {
        if (selectedPaths.has(r.path)) {
          console.log(`  ${chalk.green('✓')} ${r.name} ${chalk.dim(`(${r.path})`)}`);
        }
      });
    }
    console.log();

    const result = await search({
      message: 'Search and select repositories (type to filter, select to toggle, choose Done to finish):',
      source: async (input) => {
        const query = (input || '').toLowerCase();
        const filtered = repos.filter(
          (r) =>
            r.name.toLowerCase().includes(query) ||
            r.path.toLowerCase().includes(query)
        );

        const choices = [
          {
            name: chalk.green(`✅ Done selecting (${selectedPaths.size} repo(s) selected)`),
            value: 'done',
          },
        ];

        if (selectedPaths.size > 0) {
          choices.push({
            name: chalk.yellow('🧹 Clear all selections'),
            value: 'clear',
          });
        }

        filtered.forEach((r) => {
          const isSelected = selectedPaths.has(r.path);
          choices.push({
            name: `${isSelected ? chalk.green('✓') : ' '} ${r.name} ${chalk.dim(`(${r.path})`)}`,
            value: r.path,
          });
        });

        return choices;
      },
    });

    if (result === 'done') {
      if (selectedPaths.size === 0) {
        console.log(chalk.red('  Please select at least one repository.'));
        continue;
      }
      break;
    }

    if (result === 'clear') {
      selectedPaths.clear();
      continue;
    }

    // Toggle selected state
    if (selectedPaths.has(result)) {
      selectedPaths.delete(result);
    } else {
      selectedPaths.add(result);
    }
  }

  return repos.filter((r) => selectedPaths.has(r.path));
}

/**
 * Prompts the user to select AI assistants to generate context for.
 */
export async function promptSelectAI(
  detected: DetectedAI[],
): Promise<AIAssistant[]> {
  const selected = await checkbox({
    message: 'Select AI assistant(s) to generate context for:',
    choices: detected.map((ai) => ({
      name: `${ai.displayName} ${ai.detected ? chalk.green('✓ detected') : chalk.dim('not found')}`,
      value: ai.name,
      checked: ai.detected,
    })),
    validate: (items) => {
      if (items.length === 0) return 'Please select at least one AI assistant';
      return true;
    },
  });

  return selected as AIAssistant[];
}

/**
 * Prompts the user to select an editor to open the workspace in.
 */
export async function promptSelectEditor(
  detected: DetectedEditor[],
): Promise<DetectedEditor | null> {
  const shouldOpen = await confirm({
    message: 'Open workspace in an editor?',
    default: true,
  });

  if (!shouldOpen) return null;

  const available = detected.filter((e) => e.detected);

  if (available.length === 0) {
    console.log(chalk.yellow('  No editors detected in PATH.'));
    return null;
  }

  const selected = await checkbox({
    message: 'Select editor:',
    choices: available.map((editor) => ({
      name: editor.name,
      value: editor.command,
    })),
  });

  if (selected.length === 0) return null;

  return available.find((e) => e.command === selected[0]) ?? null;
}

/**
 * Prompts the user to select a teamwork collaboration strategy.
 */
export async function promptSelectStrategy(
  templates: WorkflowTemplate[]
): Promise<string> {
  const choices = [
    { name: '✨ Auto-suggest using AI', value: 'auto', description: 'Dynamically analyzes the task to recommend a strategy' },
    { name: '✏️  Create new custom strategy', value: 'create_new', description: 'Write a new strategy or load from a file' },
    ...templates.map((t) => ({
      name: `${t.name}${t.custom ? ' (Custom)' : ''}`,
      value: t.id,
      description: t.description,
    })),
  ];

  return select({
    message: 'Select a teamwork collaboration strategy:',
    choices,
  });
}

/**
 * Prompts the user for a new strategy name and content.
 */
export async function promptNewStrategy(): Promise<{ name: string; content: string }> {
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');

  const name = await input({
    message: 'New Strategy Name:',
    validate: (value) => value.trim().length > 0 || 'Name cannot be empty',
  });

  const descInput = await input({
    message: 'Strategy Content (or paste a path to a .md/.txt file):',
    validate: (value) => value.trim().length > 0 || 'Content cannot be empty',
  });

  const trimmed = descInput.trim();
  let content = trimmed;

  if (existsSync(trimmed)) {
    try {
      content = await readFile(trimmed, 'utf-8');
      console.log(chalk.dim(`  Read strategy from ${trimmed}`));
    } catch {}
  }

  return { name: name.trim(), content };
}
