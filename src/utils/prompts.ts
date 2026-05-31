/**
 * @module utils/prompts
 * Interactive CLI prompts for NexusFlow using @inquirer/prompts.
 */

import { input, checkbox, confirm } from '@inquirer/prompts';
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
 */
export async function promptSelectRepos(repos: RepoInfo[]): Promise<RepoInfo[]> {
  if (repos.length === 0) {
    return [];
  }

  const selected = await checkbox({
    message: 'Select projects to include:',
    choices: repos.map((repo) => ({
      name: `${repo.name} ${chalk.dim(`(${repo.path})`)}`,
      value: repo.path,
      checked: false,
    })),
    validate: (items) => {
      if (items.length === 0) return 'Please select at least one project';
      return true;
    },
  });

  return repos.filter((r) => selected.includes(r.path));
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
