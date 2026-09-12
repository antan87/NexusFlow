/**
 * @module commands/tag
 * CLI commands `ctxspace tag` (alias `ctxspace category`) — inspect and manage
 * hierarchical categories, vertical subsystems, and cross-cutting traits.
 */

import chalk from 'chalk';

import { loadFeatureConfig, saveFeatureConfig } from '../core/workspace.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import {
  getAvailableDomainPacks,
  getDomainPack,
  resolveActiveDomainRules,
  getOrganization,
} from '../core/domain-packs.js';
import { refreshWorkspace } from '../core/refresh.js';
import { BRAND_NAME } from '../core/constants.js';
import type { DomainPack } from '../types.js';

export interface TagCommandOptions {
  json?: boolean;
}

export async function tagListCommand(workspaceArg?: string, options: TagCommandOptions = {}): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  const feature = workspacePath ? await loadFeatureConfig(workspacePath) : null;
  const assigned = new Set(feature?.domainPacks ?? []);

  const allPacks = getAvailableDomainPacks();
  const verticals = allPacks.filter((p) => p.categoryType !== 'trait');
  const traits = allPacks.filter((p) => p.categoryType === 'trait');

  const resolved = feature
    ? resolveActiveDomainRules(feature.organizationId, feature.domainPacks ?? [])
    : null;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          assigned: Array.from(assigned),
          resolved,
          allPacks,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(chalk.bold.cyan(`\n🏷️  ${BRAND_NAME} — Enterprise Categories & Traits\n`));

  if (feature) {
    const org = getOrganization(feature.organizationId);
    console.log(
      chalk.dim('Workspace: ') +
        chalk.bold(feature.branchName) +
        (org ? chalk.dim(` | Root Conventions: `) + chalk.magenta(org.name) : ''),
    );
    if (resolved?.compositeVerifyCommand) {
      console.log(chalk.dim('Verification Gate: ') + chalk.green(`\`${resolved.compositeVerifyCommand}\``));
    }
    console.log();
  }

  // 1. Vertical Subsystems (Tree Hierarchy)
  console.log(chalk.bold('📦 Subsystem Verticals (Business Domains):'));
  // Find top-level verticals
  const rootVerticals = verticals.filter((v) => !v.parent);
  const childMap = new Map<string, DomainPack[]>();
  for (const v of verticals) {
    if (v.parent) {
      const list = childMap.get(v.parent) || [];
      list.push(v);
      childMap.set(v.parent, list);
    }
  }

  for (const root of rootVerticals) {
    const isAssigned = assigned.has(root.id);
    const badge = isAssigned ? chalk.green('✔ [active]') : chalk.dim('○');
    console.log(`  ${badge} ${chalk.bold(root.name)} ${chalk.dim(`(#${root.id})`)}`);
    console.log(`    ${chalk.dim(root.description)}`);
    if (root.verifyCommand) {
      console.log(`    ${chalk.dim('Gate:')} ${chalk.yellow(root.verifyCommand)}`);
    }

    const children = childMap.get(root.id) || [];
    for (const child of children) {
      const isChildAssigned = assigned.has(child.id);
      const childBadge = isChildAssigned ? chalk.green('✔ [active]') : chalk.dim('○');
      console.log(`    └── ${childBadge} ${chalk.bold(child.name)} ${chalk.dim(`(#${child.id})`)}`);
      console.log(`        ${chalk.dim(child.description)}`);
      if (child.verifyCommand) {
        console.log(`        ${chalk.dim('Gate:')} ${chalk.yellow(child.verifyCommand)}`);
      }
      if (child.microservices && child.microservices.length > 0) {
        const msList = child.microservices.map((m) => `${m.name} (${m.target ?? 'edit'})`).join(', ');
        console.log(`        ${chalk.dim('Microservices:')} ${chalk.cyan(msList)}`);
      }
    }
  }

  // 2. Horizontal Traits
  console.log();
  console.log(chalk.bold('🛡️  Horizontal Traits (Cross-cutting Invariants):'));
  for (const trait of traits) {
    const isAssigned = assigned.has(trait.id);
    const badge = isAssigned ? chalk.green('✔ [active]') : chalk.dim('○');
    console.log(`  ${badge} ${chalk.bold(trait.name)} ${chalk.dim(`(#${trait.id})`)}`);
    console.log(`    ${chalk.dim(trait.description)}`);
    if (trait.rules && trait.rules.length > 0) {
      console.log(`    ${chalk.dim('Rules:')} ${chalk.dim(trait.rules[0])}`);
    }
  }

  console.log();
  console.log(chalk.dim(`Usage: ctxspace tag add <id> | ctxspace tag remove <id> | ctxspace tag show <id>`));
  console.log();
}

export async function tagAddCommand(
  tagId: string,
  workspaceArg?: string,
): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red(`Failed to load workspace config at ${workspacePath}`));
    process.exitCode = 1;
    return;
  }

  const pack = getDomainPack(tagId);
  if (!pack) {
    console.error(chalk.red(`Category / tag "${tagId}" not found. Run 'ctxspace tag list' to see available tags.`));
    process.exitCode = 1;
    return;
  }

  const current = new Set(feature.domainPacks ?? []);
  if (current.has(pack.id)) {
    console.log(chalk.yellow(`Tag "${pack.name}" (#${pack.id}) is already active in workspace ${feature.branchName}.`));
    return;
  }

  current.add(pack.id);
  feature.domainPacks = Array.from(current);
  await saveFeatureConfig(workspacePath, feature);
  await refreshWorkspace(workspacePath, { force: true }).catch(() => {});

  console.log(chalk.green(`\n✔ Added category tag "${chalk.bold(pack.name)}" to ${feature.branchName}`));
  console.log(chalk.dim(`Refreshed AGENTS.md with scoped domain rules and verification gates.\n`));
}

export async function tagRemoveCommand(
  tagId: string,
  workspaceArg?: string,
): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red(`Failed to load workspace config at ${workspacePath}`));
    process.exitCode = 1;
    return;
  }

  const current = new Set(feature.domainPacks ?? []);
  if (!current.has(tagId)) {
    console.log(chalk.yellow(`Tag "${tagId}" is not attached to workspace ${feature.branchName}.`));
    return;
  }

  current.delete(tagId);
  feature.domainPacks = Array.from(current);
  await saveFeatureConfig(workspacePath, feature);
  await refreshWorkspace(workspacePath, { force: true }).catch(() => {});

  console.log(chalk.green(`\n✔ Removed category tag "${tagId}" from ${feature.branchName}`));
  console.log(chalk.dim(`Refreshed AGENTS.md context.\n`));
}

export async function tagShowCommand(tagId: string, options: TagCommandOptions = {}): Promise<void> {
  const pack = getDomainPack(tagId);
  if (!pack) {
    console.error(chalk.red(`Category / tag "${tagId}" not found.`));
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\n🏷️  Category: ${pack.name} (#${pack.id})\n`));
  console.log(chalk.dim('Type: ') + (pack.categoryType === 'trait' ? chalk.magenta('Horizontal Trait') : chalk.blue('Vertical Subsystem')));
  if (pack.parent) {
    console.log(chalk.dim('Parent Hierarchy: ') + chalk.bold(pack.parent));
  }
  console.log(chalk.dim('Description: ') + pack.description);

  if (pack.verifyCommand) {
    console.log(chalk.dim('Verification Gate: ') + chalk.yellow(pack.verifyCommand));
  }

  if (pack.tags && pack.tags.length > 0) {
    console.log(chalk.dim('Keywords / Match Tags: ') + pack.tags.join(', '));
  }

  if (pack.microservices && pack.microservices.length > 0) {
    console.log(chalk.dim('\nMicroservice Bindings:'));
    for (const ms of pack.microservices) {
      console.log(`  • ${chalk.bold(ms.name)} [${ms.target ?? 'edit'}]${ms.description ? ` — ${ms.description}` : ''}`);
    }
  }

  if (pack.rules && pack.rules.length > 0) {
    console.log(chalk.dim('\nArchitectural Invariants & Rules:'));
    for (const rule of pack.rules) {
      console.log(`  › ${rule}`);
    }
  }
  console.log();
}
