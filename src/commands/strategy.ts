/**
 * @module commands/strategy
 * CLI subcommands for managing teamwork collaboration strategy templates.
 * Provides list, create, edit, and delete operations for strategy templates
 * stored in ~/.nexusflow/workflows/.
 */

import chalk from 'chalk';
import { confirm, input, select, editor } from '@inquirer/prompts';

import {
  getWorkflowTemplates,
  saveWorkflowTemplate,
  deleteWorkflowTemplate,
  type WorkflowTemplate,
} from '../utils/workflows.js';

/**
 * Lists all available strategy templates (built-in and custom).
 */
export async function strategyListCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n📋 NexusFlow — Strategy Templates\n'));

  const templates = await getWorkflowTemplates();

  if (templates.length === 0) {
    console.log(chalk.yellow('  No strategy templates found.'));
    return;
  }

  const builtIn = templates.filter((t) => !t.custom);
  const custom = templates.filter((t) => t.custom);

  if (builtIn.length > 0) {
    console.log(chalk.bold('  Built-in Strategies:'));
    for (const t of builtIn) {
      console.log(`    ${chalk.green('●')} ${chalk.bold(t.name)} ${chalk.dim(`(${t.id})`)}`);
      console.log(`      ${chalk.dim(t.description)}`);
    }
    console.log();
  }

  if (custom.length > 0) {
    console.log(chalk.bold('  Custom Strategies:'));
    for (const t of custom) {
      console.log(`    ${chalk.blue('●')} ${chalk.bold(t.name)} ${chalk.dim(`(${t.id})`)}`);
      console.log(`      ${chalk.dim(t.description)}`);
    }
    console.log();
  }

  console.log(chalk.dim(`  Total: ${builtIn.length} built-in, ${custom.length} custom\n`));
}

/**
 * Creates a new custom strategy template.
 */
export async function strategyCreateCommand(options: { name?: string; file?: string }): Promise<void> {
  console.log(chalk.bold.cyan('\n✏️  NexusFlow — Create Strategy Template\n'));

  const name = options.name || await input({
    message: 'Strategy Name:',
    validate: (value) => value.trim().length > 0 || 'Name cannot be empty',
  });

  let content: string;

  if (options.file) {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');

    if (!existsSync(options.file)) {
      console.error(chalk.red(`  ✖ File not found: ${options.file}`));
      process.exitCode = 1;
      return;
    }

    content = await readFile(options.file, 'utf-8');
    console.log(chalk.dim(`  Read strategy from ${options.file}`));
  } else {
    content = await editor({
      message: 'Write your strategy content (save and close the editor when done):',
      default: `# ${name.trim()}\n\nDescribe your teamwork cooperation guidelines here.\n\n## Guidelines\n\n- \n`,
      waitForUserInput: false,
    });
  }

  if (!content.trim()) {
    console.log(chalk.yellow('  ⚠ Empty content — aborting.'));
    return;
  }

  try {
    const template = await saveWorkflowTemplate(name.trim(), content.trim());
    console.log(chalk.green(`  ✔ Saved strategy: ${chalk.bold(template.name)} (${template.id})`));
  } catch (err) {
    console.error(chalk.red(`  ✖ Failed to save strategy: ${err}`));
    process.exitCode = 1;
  }
}

/**
 * Edits an existing custom strategy template.
 */
export async function strategyEditCommand(options: { id?: string }): Promise<void> {
  console.log(chalk.bold.cyan('\n✏️  NexusFlow — Edit Strategy Template\n'));

  const templates = await getWorkflowTemplates();
  const customTemplates = templates.filter((t) => t.custom);

  if (customTemplates.length === 0) {
    console.log(chalk.yellow('  No custom strategy templates to edit.'));
    console.log(chalk.dim('  Built-in templates cannot be edited. Use "nexusflow strategy create" to make a custom override.\n'));
    return;
  }

  let templateId = options.id;
  if (!templateId) {
    templateId = await select({
      message: 'Select a custom strategy to edit:',
      choices: customTemplates.map((t) => ({
        name: `${t.name} ${chalk.dim(`(${t.id})`)}`,
        value: t.id,
      })),
    });
  }

  const template = customTemplates.find((t) => t.id === templateId);
  if (!template) {
    console.error(chalk.red(`  ✖ Custom template "${templateId}" not found.`));
    process.exitCode = 1;
    return;
  }

  const content = await editor({
    message: `Editing "${template.name}" (save and close the editor when done):`,
    default: template.content,
    waitForUserInput: false,
  });

  if (!content.trim()) {
    console.log(chalk.yellow('  ⚠ Empty content — no changes saved.'));
    return;
  }

  try {
    const updated = await saveWorkflowTemplate(template.name, content.trim(), template.id);
    console.log(chalk.green(`  ✔ Updated strategy: ${chalk.bold(updated.name)} (${updated.id})`));
  } catch (err) {
    console.error(chalk.red(`  ✖ Failed to save changes: ${err}`));
    process.exitCode = 1;
  }
}

/**
 * Deletes a custom strategy template.
 */
export async function strategyDeleteCommand(options: { id?: string; yes?: boolean }): Promise<void> {
  console.log(chalk.bold.cyan('\n🗑️  NexusFlow — Delete Strategy Template\n'));

  const templates = await getWorkflowTemplates();
  const customTemplates = templates.filter((t) => t.custom);

  if (customTemplates.length === 0) {
    console.log(chalk.yellow('  No custom strategy templates to delete.\n'));
    return;
  }

  let templateId = options.id;
  if (!templateId) {
    templateId = await select({
      message: 'Select a custom strategy to delete:',
      choices: customTemplates.map((t) => ({
        name: `${t.name} ${chalk.dim(`(${t.id})`)}`,
        value: t.id,
      })),
    });
  }

  const template = customTemplates.find((t) => t.id === templateId);
  if (!template) {
    console.error(chalk.red(`  ✖ Custom template "${templateId}" not found.`));
    process.exitCode = 1;
    return;
  }

  if (!options.yes) {
    const confirmed = await confirm({
      message: `Are you sure you want to delete "${template.name}"?`,
      default: false,
    });
    if (!confirmed) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  try {
    await deleteWorkflowTemplate(template.id);
    console.log(chalk.green(`  ✔ Deleted strategy: ${chalk.bold(template.name)}`));
  } catch (err) {
    console.error(chalk.red(`  ✖ Failed to delete strategy: ${err}`));
    process.exitCode = 1;
  }
}

/**
 * Shows the full content of a strategy template.
 */
export async function strategyShowCommand(options: { id?: string }): Promise<void> {
  const templates = await getWorkflowTemplates();

  let templateId = options.id;
  if (!templateId) {
    templateId = await select({
      message: 'Select a strategy to view:',
      choices: templates.map((t) => ({
        name: `${t.name}${t.custom ? ' (Custom)' : ''} ${chalk.dim(`(${t.id})`)}`,
        value: t.id,
      })),
    });
  }

  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    console.error(chalk.red(`  ✖ Template "${templateId}" not found.`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold.cyan(`\n📄 ${template.name}${template.custom ? chalk.blue(' (Custom)') : ''}\n`));
  console.log(template.content);
  console.log();
}
