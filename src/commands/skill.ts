/**
 * @module commands/skill
 * CLI commands `ctxspace skill` — list, inspect, create, and remove agent skills.
 */

import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fse from 'fs-extra';

import { getAllSkills, saveSkill, deleteSkill, type SkillItem } from '../utils/skills-catalog.js';
import { resolveWorkspaceInteractive, resolveWorkspaceQuiet } from '../utils/resolve-workspace.js';
import { refreshWorkspace } from '../core/refresh.js';
import { BRAND_NAME } from '../core/constants.js';

export interface SkillListOptions {
  json?: boolean;
  scope?: 'all' | 'workspace' | 'global';
  tag?: string | string[];
}

export async function skillListCommand(workspaceArg?: string, options: SkillListOptions = {}): Promise<void> {
  let workspacePath: string | null = null;
  if (workspaceArg) {
    try {
      workspacePath = await resolveWorkspaceQuiet(workspaceArg);
    } catch (error) {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}\n`));
      process.exitCode = 1;
      return;
    }
  } else {
    workspacePath = await resolveWorkspaceQuiet().catch(() => null);
  }
  const skills = await getAllSkills(workspacePath || undefined);

  let filtered = skills;
  if (options.scope === 'workspace') {
    filtered = filtered.filter((s) => s.scope === 'workspace');
  } else if (options.scope === 'global') {
    filtered = filtered.filter((s) => s.scope !== 'workspace');
  }
  if (options.tag) {
    const tags = (Array.isArray(options.tag) ? options.tag : [options.tag]).map((tag) => tag.toLowerCase().trim());
    filtered = filtered.filter((s) => tags.every((tag) => s.tags?.some((t) => t.toLowerCase() === tag)));
  }

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\n🛠️  ${BRAND_NAME} — Agent Skills\n`));

  if (workspacePath) {
    console.log(chalk.dim('Workspace: ') + chalk.bold(path.basename(workspacePath)) + '\n');
  }

  if (filtered.length === 0) {
    console.log(chalk.dim('  (No skills found in catalog.)\n'));
    console.log(chalk.dim('  Create a skill with: ') + chalk.cyan('ctxspace skill create <id>\n'));
    return;
  }

  const workspaceSkills = filtered.filter((s) => s.scope === 'workspace');
  const globalSkills = filtered.filter((s) => s.scope !== 'workspace');

  if (workspaceSkills.length > 0) {
    console.log(chalk.bold.yellow('📂 Workspace-Specific Skills (local to this project):'));
    for (const s of workspaceSkills) {
      const tagsStr = s.tags?.length ? chalk.dim(` [${s.tags.join(', ')}]`) : '';
      console.log(`  ${chalk.green('●')} ${chalk.bold(s.id)} — ${s.title}${tagsStr}`);
      if (s.description) console.log(chalk.dim(`    ${s.description}`));
    }
    console.log('');
  }

  if (globalSkills.length > 0) {
    console.log(chalk.bold.blue('🌐 Global Company Skills (shared across workspaces):'));
    for (const s of globalSkills) {
      const tagsStr = s.tags?.length ? chalk.dim(` [${s.tags.join(', ')}]`) : '';
      console.log(`  ${chalk.blue('●')} ${chalk.bold(s.id)} — ${s.title}${tagsStr}`);
      if (s.description) console.log(chalk.dim(`    ${s.description}`));
    }
    console.log('');
  }
}

export interface SkillCreateOptions {
  title?: string;
  description?: string;
  content?: string;
  tags?: string[];
  tag?: string[] | string;
  scope?: 'workspace' | 'global';
  file?: string;
}

export async function skillCreateCommand(
  id: string,
  workspaceArg?: string,
  options: SkillCreateOptions = {},
): Promise<void> {
  const cleanId = id.trim().toLowerCase();
  if (!cleanId) {
    console.error(chalk.red('Error: Skill ID is required.'));
    process.exit(1);
  }

  let workspacePath: string | null = null;
  const scope = options.scope ?? (workspaceArg ? 'workspace' : 'global');

  if (scope === 'workspace') {
    workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select workspace for this local skill:');
    if (!workspacePath) {
      console.error(chalk.red('Error: A workspace must be selected for workspace-scoped skills.'));
      process.exit(1);
    }
  }

  let content = options.content ?? '';
  if (options.file) {
    try {
      content = await fs.readFile(options.file, 'utf-8');
    } catch (err: any) {
      console.error(chalk.red(`Error reading skill file: ${err.message}`));
      process.exit(1);
    }
  }

  const title = options.title || cleanId;
  const description = options.description || `Skill for ${cleanId}`;
  if (!content) {
    content = `# ${title}\n\n${description}\n\n## Instructions\n1. Follow standard procedures.`;
  }

  try {
    const tags = options.tag ?? options.tags ?? [];
    const saved = await saveSkill(
      {
        id: cleanId,
        name: cleanId,
        title,
        description,
        content,
        tags: Array.isArray(tags) ? tags : [tags],
      },
      {
        scope,
        workspacePath: workspacePath || undefined,
      },
    );

    if (workspacePath) {
      await refreshWorkspace(workspacePath, { force: true }).catch(() => {});
    }

    console.log(chalk.green(`\n✔ Skill "${saved.title || saved.id}" created successfully!`));
    console.log(chalk.dim(`  Scope:   ${scope === 'workspace' ? 'Workspace-local' : 'Global'}`));
    console.log(chalk.dim(`  Path:    ${(saved as any).path}`));
    if (saved.tags?.length) {
      console.log(chalk.dim(`  Tags:    ${saved.tags.join(', ')}`));
    }
    console.log('');
  } catch (err: any) {
    console.error(chalk.red(`\nError creating skill: ${err.message}\n`));
    process.exit(1);
  }
}

export async function skillDeleteCommand(
  id: string,
  workspaceArg?: string,
  options: { scope?: 'workspace' | 'global' } = {},
): Promise<void> {
  const cleanId = id.trim().toLowerCase();
  if (!cleanId) {
    console.error(chalk.red('Error: Skill ID is required.'));
    process.exitCode = 1;
    return;
  }

  let scope: 'workspace' | 'global' = options.scope ?? 'global';
  let workspacePath: string | null = null;

  if (options.scope === 'global') {
    scope = 'global';
  } else if (options.scope === 'workspace') {
    scope = 'workspace';
    workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:').catch(() => null);
    if (!workspacePath) {
      console.error(chalk.red('Error: A workspace must be selected to delete a workspace-scoped skill.'));
      process.exitCode = 1;
      return;
    }
  } else {
    workspacePath = await resolveWorkspaceQuiet(workspaceArg).catch(() => null);
    if (workspacePath) {
      const wsSkillDir = path.join(workspacePath, '.agents', 'skills', cleanId);
      const existsLocally = await fse.pathExists(wsSkillDir);
      scope = existsLocally ? 'workspace' : 'global';
    } else {
      scope = 'global';
    }
  }

  try {
    await deleteSkill(cleanId, {
      scope,
      workspacePath: workspacePath || undefined,
    });

    if (workspacePath && scope === 'workspace') {
      await refreshWorkspace(workspacePath, { force: true }).catch(() => {});
    }

    console.log(chalk.green(`\n✔ Skill "${cleanId}" deleted successfully (${scope} scope).\n`));
  } catch (err: any) {
    console.error(chalk.red(`\nError deleting skill: ${err.message}\n`));
    process.exitCode = 1;
  }
}

export interface SkillShowOptions {
  json?: boolean;
}

export async function skillShowCommand(
  id: string,
  workspaceArg?: string,
  options: SkillShowOptions = {},
): Promise<void> {
  const cleanId = id.trim().toLowerCase();
  if (!cleanId) {
    console.error(chalk.red('Error: Skill ID is required.'));
    process.exitCode = 1;
    return;
  }

  let workspacePath: string | null = null;
  if (workspaceArg) {
    try {
      workspacePath = await resolveWorkspaceQuiet(workspaceArg);
    } catch (error) {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}\n`));
      process.exitCode = 1;
      return;
    }
  } else {
    workspacePath = await resolveWorkspaceQuiet().catch(() => null);
  }

  const skills = await getAllSkills(workspacePath || undefined);
  const skill = skills.find((s) => s.id.toLowerCase() === cleanId || s.name?.toLowerCase() === cleanId);

  if (!skill) {
    console.error(chalk.red(`\nError: Skill "${id}" not found in catalog or workspace.\n`));
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\n🛠️  Skill: ${skill.title || skill.id} (${chalk.bold(skill.id)})\n`));
  console.log(chalk.dim('Scope:        ') + (skill.scope === 'workspace' ? chalk.yellow('Workspace-local') : chalk.blue('Global / Personal')));
  console.log(chalk.dim('Category:     ') + chalk.magenta(skill.category || 'general'));
  if (skill.sourcePath) {
    console.log(chalk.dim('Source Path:  ') + chalk.dim(skill.sourcePath));
  }
  if (skill.description) {
    console.log(chalk.dim('Description:  ') + skill.description);
  }
  if (skill.tags?.length) {
    console.log(chalk.dim('Tags:         ') + skill.tags.join(', '));
  }
  if (skill.allowedTools?.length) {
    console.log(chalk.dim('Allowed Tools:') + ' ' + skill.allowedTools.join(', '));
  }
  if (skill.references?.length) {
    console.log(chalk.dim('\nReferences:'));
    for (const ref of skill.references) {
      console.log(`  • ${chalk.bold(ref.name)} ${chalk.dim(`(${ref.relativePath})`)}`);
    }
  }
  if (skill.scripts?.length) {
    console.log(chalk.dim('\nScripts:'));
    for (const script of skill.scripts) {
      console.log(`  • ${chalk.bold(script.name)} ${chalk.dim(`(${script.relativePath})`)}`);
    }
  }

  if (skill.content) {
    console.log(chalk.dim('\n─── Instructions ──────────────────────────────────────────'));
    console.log(skill.content.trim());
    console.log(chalk.dim('───────────────────────────────────────────────────────────\n'));
  } else {
    console.log();
  }
}
