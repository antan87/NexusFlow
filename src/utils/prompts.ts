/**
 * @module utils/prompts
 * Interactive CLI prompts for NexusFlow using @inquirer/prompts.
 */

import { input, checkbox, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';

import type { AIAssistant, DetectedAI, DetectedEditor, RepoInfo } from '../types.js';

/**
 * Prompts the user for a feature branch name.
 */
export async function promptBranchName(): Promise<string> {
  const branchName = await input({
    message: 'Feature branch name:',
    validate: (value: string) => {
      if (!value.trim()) return 'Branch name cannot be empty';
      if (/\s/.test(value)) return 'Branch name cannot contain spaces';
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

    const action = await select({
      message: 'Choose repository selection mode:',
      choices: [
        { name: '🔍 Search & toggle repositories by name', value: 'search' },
        { name: '📋 View & toggle full repository list', value: 'toggle_all' },
        { name: `✅ Done selecting (${selectedPaths.size} repo(s) selected)`, value: 'done' },
      ],
    });

    if (action === 'done') {
      if (selectedPaths.size === 0) {
        console.log(chalk.red('  Please select at least one repository.'));
        continue;
      }
      break;
    }

    if (action === 'search') {
      const searchTerm = await input({
        message: 'Enter search term (name or path):',
      });

      const filtered = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.path.toLowerCase().includes(searchTerm.toLowerCase())
      );

      if (filtered.length === 0) {
        console.log(chalk.yellow(`  No repositories found matching "${searchTerm}".`));
        continue;
      }

      const toggled = await checkbox({
        message: `Toggle matching repositories (found ${filtered.length}):`,
        choices: filtered.map((repo) => ({
          name: `${repo.name} ${chalk.dim(`(${repo.path})`)}`,
          value: repo.path,
          checked: selectedPaths.has(repo.path),
        })),
      });

      // Update selections for the filtered set
      filtered.forEach((repo) => {
        if (toggled.includes(repo.path)) {
          selectedPaths.add(repo.path);
        } else {
          selectedPaths.delete(repo.path);
        }
      });
    }

    if (action === 'toggle_all') {
      const toggled = await checkbox({
        message: 'Select projects to include (full list):',
        choices: repos.map((repo) => ({
          name: `${repo.name} ${chalk.dim(`(${repo.path})`)}`,
          value: repo.path,
          checked: selectedPaths.has(repo.path),
        })),
      });

      selectedPaths.clear();
      toggled.forEach((p) => selectedPaths.add(p));
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
