/**
 * @module utils/prompts
 * Interactive CLI prompts for NexusFlow using @inquirer/prompts.
 */

import { input, checkbox, confirm, select, search, editor } from '@inquirer/prompts';
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
 * Offers short inline typing, multi-line editor (safe for pasting), or loading from file.
 */
export async function promptDescription(): Promise<string> {
  const mode = await select({
    message: 'How do you want to provide the feature description?',
    choices: [
      { name: '✍️  Type short description', value: 'short', description: 'Type a single-line description directly in the terminal' },
      { name: '📝 Write in editor', value: 'editor', description: 'Opens your $EDITOR (safest for copy-pasting multi-line text)' },
      { name: '📂 Load from file', value: 'file', description: 'Paste a path to a .md or .txt file' },
    ],
  });

  if (mode === 'short') {
    const desc = await input({
      message: 'Feature description:',
      validate: (value: string) => {
        if (!value.trim()) return 'Description cannot be empty';
        return true;
      },
    });
    return desc.trim();
  }

  if (mode === 'editor') {
    const desc = await editor({
      message: 'Write or paste your feature description (save and close the editor when done):',
      default: '',
      waitForUserInput: false,
    });
    if (!desc.trim()) {
      console.log(chalk.yellow('  ⚠ Empty description provided.'));
      return 'No description provided.';
    }
    return desc.trim();
  }

  // File mode
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');

  const filePath = await input({
    message: 'Path to description file (.md or .txt):',
    validate: (value) => {
      if (!value.trim()) return 'Path cannot be empty';
      if (!existsSync(value.trim())) return 'File not found';
      return true;
    },
  });

  const content = await readFile(filePath.trim(), 'utf-8');
  console.log(chalk.dim(`  Read description from ${filePath.trim()}`));
  return content.trim();
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
 * Shows a preview of the selected template before confirming.
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

  while (true) {
    const selectedId = await select({
      message: 'Select a teamwork collaboration strategy:',
      choices,
    });

    // Auto and create_new don't need a preview
    if (selectedId === 'auto' || selectedId === 'create_new') {
      return selectedId;
    }

    // Show preview for template-based strategies
    const template = templates.find((t) => t.id === selectedId);
    if (template) {
      console.log(chalk.bold(`\n📄 Preview: ${template.name}\n`));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(template.content);
      console.log(chalk.dim('─'.repeat(60)));

      const confirmed = await confirm({
        message: 'Use this strategy?',
        default: true,
      });

      if (confirmed) {
        return selectedId;
      }
      // Loop back to selection if not confirmed
      console.log();
    } else {
      return selectedId;
    }
  }
}

/**
 * Prompts the user for a new strategy name and content.
 * Offers two input modes: open $EDITOR for multi-line authoring, or load from a file.
 */
export async function promptNewStrategy(): Promise<{ name: string; content: string }> {
  const name = await input({
    message: 'New Strategy Name:',
    validate: (value) => value.trim().length > 0 || 'Name cannot be empty',
  });

  const mode = await select({
    message: 'How do you want to provide the strategy content?',
    choices: [
      { name: '📝 Write in editor', value: 'editor', description: 'Opens your $EDITOR for multi-line content' },
      { name: '📂 Load from file', value: 'file', description: 'Paste a path to a .md or .txt file' },
    ],
  });

  let content: string;

  if (mode === 'file') {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');

    const filePath = await input({
      message: 'Path to strategy file (.md or .txt):',
      validate: (value) => {
        if (!value.trim()) return 'Path cannot be empty';
        if (!existsSync(value.trim())) return 'File not found';
        return true;
      },
    });

    content = await readFile(filePath.trim(), 'utf-8');
    console.log(chalk.dim(`  Read strategy from ${filePath.trim()}`));
  } else {
    content = await editor({
      message: 'Write your strategy content (save and close the editor when done):',
      default: `# ${name.trim()}\n\nDescribe your teamwork cooperation guidelines here.\n\n## Guidelines\n\n- \n`,
      waitForUserInput: false,
    });
  }

  if (!content.trim()) {
    content = `# ${name.trim()}\n\nCustom strategy template.`;
  }

  return { name: name.trim(), content: content.trim() };
}
