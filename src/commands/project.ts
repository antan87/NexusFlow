/**
 * @module commands/project
 * CLI subcommands for managing the project registry — named groups of source
 * repositories that features are started from. Registry lives at
 * ~/.nexusflow/projects.json; removing a project never touches disk.
 */

import chalk from 'chalk';
import { confirm, input, select } from '@inquirer/prompts';

import {
  loadProjects,
  getProject,
  createProject,
  removeProject,
} from '../core/projects.js';
import { loadConfig } from '../core/config.js';
import { scanForRepos } from '../core/scanner.js';
import { promptSelectRepos } from '../utils/prompts.js';
import type { Project } from '../types.js';

function printProject(project: Project): void {
  console.log(`    ${chalk.green('●')} ${chalk.bold(project.name)} ${chalk.dim(`(${project.id})`)}`);
  if (project.description) {
    console.log(`      ${chalk.dim(project.description)}`);
  }
  for (const repo of project.repos) {
    console.log(`      ${chalk.dim('└')} ${repo.path} ${chalk.dim(`[${repo.defaultBranch}]`)}`);
  }
}

/**
 * Lists all registered projects.
 */
export async function projectListCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n📁 NexusFlow — Projects\n'));

  const projects = await loadProjects();
  if (projects.length === 0) {
    console.log(chalk.yellow('  No projects registered yet.'));
    console.log(chalk.dim('  Register one with: nexusflow project add\n'));
    return;
  }

  for (const project of projects) {
    printProject(project);
    console.log();
  }
  console.log(chalk.dim(`  Total: ${projects.length} project${projects.length === 1 ? '' : 's'}\n`));
}

/**
 * Registers a new project: prompts for a name and a repo selection from the
 * configured dev directory (or takes both from flags).
 */
export async function projectAddCommand(options: {
  name?: string;
  repos?: string[];
  description?: string;
}): Promise<void> {
  console.log(chalk.bold.cyan('\n📁 NexusFlow — Register Project\n'));

  const name = options.name || await input({
    message: 'Project name:',
    validate: (value) => value.trim().length > 0 || 'Name cannot be empty',
  });

  let repoPaths = options.repos;
  if (!repoPaths || repoPaths.length === 0) {
    const config = await loadConfig();
    console.log(chalk.dim(`  Scanning ${config.devDir} for repositories...`));
    const available = await scanForRepos(config.devDir, config.scanDepth);
    if (available.length === 0) {
      console.error(chalk.red(`  ✖ No git repositories found under ${config.devDir}.`));
      process.exitCode = 1;
      return;
    }
    const selected = await promptSelectRepos(available);
    repoPaths = selected.map((r) => r.path);
  }

  const project = await createProject(name, repoPaths, options.description);

  console.log(chalk.green(`\n  ✔ Registered project "${project.name}"\n`));
  printProject(project);
  console.log();
}

/** Prompts for a project when no id was given on the command line. */
async function resolveProjectId(id: string | undefined, action: string): Promise<Project | null> {
  if (id) {
    const project = await getProject(id);
    if (!project) {
      console.error(chalk.red(`  ✖ No project with id "${id}".`));
      process.exitCode = 1;
      return null;
    }
    return project;
  }

  const projects = await loadProjects();
  if (projects.length === 0) {
    console.log(chalk.yellow('  No projects registered yet.'));
    return null;
  }
  const chosen = await select({
    message: `Which project do you want to ${action}?`,
    choices: projects.map((p) => ({
      name: `${p.name} (${p.repos.length} repo${p.repos.length === 1 ? '' : 's'})`,
      value: p.id,
    })),
  });
  return getProject(chosen);
}

/**
 * Shows the details of a single project.
 */
export async function projectShowCommand(id?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n📁 NexusFlow — Project\n'));
  const project = await resolveProjectId(id, 'show');
  if (!project) return;

  printProject(project);
  console.log(chalk.dim(`\n  Created: ${project.createdAt}`));
  console.log(chalk.dim(`  Updated: ${project.updatedAt}\n`));
}

/**
 * Removes a project from the registry (never touches anything on disk).
 */
export async function projectRemoveCommand(id: string | undefined, options: { yes?: boolean }): Promise<void> {
  console.log(chalk.bold.cyan('\n📁 NexusFlow — Remove Project\n'));
  const project = await resolveProjectId(id, 'remove');
  if (!project) return;

  if (!options.yes) {
    const sure = await confirm({
      message: `Remove "${project.name}" from the registry? (repos and workspaces on disk are not touched)`,
      default: false,
    });
    if (!sure) {
      console.log(chalk.dim('  Cancelled.\n'));
      return;
    }
  }

  await removeProject(project.id);
  console.log(chalk.green(`  ✔ Removed project "${project.name}" from the registry.\n`));
}
