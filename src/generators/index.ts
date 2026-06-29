import chalk from 'chalk';
import path from 'node:path';
import fse from 'fs-extra';
import type { AIAssistant, WorkspaceContext } from '../types.js';
import { generateClaudeConfig } from './claude.js';
import { generateAntigravityConfig } from './antigravity.js';
import { generateCodexConfig } from './codex.js';
import { generateCopilotConfig } from './copilot.js';
import { generateCursorConfig } from './cursor.js';
import { buildContextContent } from './base.js';
import { generateImplementationPlan } from './plan-generator.js';
import { generateSkills } from './skills-generator.js';
import { writeWorkspaceFile, workspaceFileExists, writeBaseFile, readBaseFile, baseFileExists } from '../core/storage.js';
import { generateDiffContext } from './diff-context.js';

/** Maps each assistant to its generator function and the file it produces. */
const GENERATORS: Record<
  AIAssistant,
  {
    generate: (ctx: WorkspaceContext, workspacePath: string) => Promise<void>;
    outputFile: string;
  }
> = {
  claude: { generate: generateClaudeConfig, outputFile: 'CLAUDE.md' },
  antigravity: { generate: generateAntigravityConfig, outputFile: 'AGENTS.md' },
  codex: { generate: generateCodexConfig, outputFile: 'AGENTS.md' },
  copilot: { generate: generateCopilotConfig, outputFile: '.github/copilot-instructions.md' },
  cursor: { generate: generateCursorConfig, outputFile: '.cursor/rules/nexusflow.mdc' },
};

/**
 * Builds the nexusflow-knowledge.md content — a persistent AI memory file.
 */
function buildKnowledgeContent(ctx: WorkspaceContext): string {
  const { feature, repos, analysis } = ctx;

  // Build repo list with tech stack info if available
  const repoList = repos.map((r) => {
    if (analysis && analysis.has(r.path)) {
      const a = analysis.get(r.path)!;
      const tech = a.techStack.frameworks.length > 0
        ? ` (${a.techStack.languages.join(', ')} — ${a.techStack.frameworks.join(', ')})`
        : a.techStack.languages[0] !== 'other'
          ? ` (${a.techStack.languages.join(', ')})`
          : '';
      return `- **${r.name}**${tech}`;
    }
    return `- **${r.name}**`;
  }).join('\n');

  // Build initial progress checklist
  const progressItems = repos.map((r) => `- [ ] ${r.name} — changes implemented and tested`).join('\n');

  return `# Workspace Knowledge — ${feature.id}

> **This file is a living document.** AI assistants should read this at the
> start of each session and append new learnings at the end.
> It preserves context across sessions so decisions aren't lost or repeated.

## Feature Goal

${feature.description}

**Branch:** \`${feature.branchName}\`
**Created:** ${feature.createdAt}

## Repos in This Workspace

${repoList}

## Project Assumptions (verify with user)

<!-- AI assistants: Fill this in during your first session. List each project and describe what you assume its main purpose, tech stack, and responsibilities are. -->

_(No assumptions recorded yet. AI assistant to populate.)_

## Clarifying Questions for the User

<!-- AI assistants: List any clarifying questions or ambiguities about requirements/architecture here. -->

_(No open questions recorded yet. AI assistant to populate.)_

## Architecture Decisions

<!-- AI assistants: append decisions here as they are made during development.
     Format: ### YYYY-MM-DD — Decision Title
     **Decision:** What was decided
     **Alternatives considered:** What else was evaluated
     **Reasoning:** Why this choice was made -->

_(No decisions recorded yet.)_

## Implementation Progress

${progressItems}

## Known Gotchas

<!-- AI assistants: append any gotchas, workarounds, or "watch out for" items
     discovered during development. These help future sessions avoid repeating
     the same debugging. -->

_(No gotchas recorded yet.)_
`;
}

/**
 * Builds the base codebase knowledge starter content.
 */
function buildBaseKnowledgeContent(repoName: string): string {
  return `# Base Codebase Knowledge — ${repoName}

> **This is a persistent cross-session memory file for ${repoName}.**
> AI assistants should read this at the start of each session, and append new architectural learnings, conventions, decisions, and gotchas at the end.
> This file persists across all features and tasks for this repository.

## Architecture & Domain Concepts
<!-- Document major design patterns, domain layers, and system concepts here. -->
- None recorded yet.

## Coding Conventions & Invariants
<!-- Document coding styles, library rules, and invariants that must not be broken. -->
- None recorded yet.

## Discovered Gotchas & Watch-outs
<!-- Document weird behaviors, workarounds, or bugs to avoid repeating them. -->
- None recorded yet.

## Architecture Decisions
<!-- Document key architectural decisions made for this repository over time. -->
- None recorded yet.
`;
}

/**
 * Generates AI context files for each of the selected assistants.
 *
 * Also generates:
 * - WORKSPACE.md — universal context file
 * - nexusflow-knowledge.md — persistent AI memory across sessions
 * - nexusflow-plan.md — implementation order based on dependency analysis
 *
 * @param ctx           - The workspace context (feature + repos).
 * @param assistants    - Which AI assistants to generate context files for.
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateContextFiles(
  ctx: WorkspaceContext,
  assistants: AIAssistant[],
  workspacePath: string,
  onlyRepo?: string,
  onlyBase?: boolean,
): Promise<void> {
  // Always generate a universal WORKSPACE.md at the workspace root
  if (!onlyBase) {
    try {
      const content = buildContextContent(ctx);
      await writeWorkspaceFile(workspacePath, ctx.feature.id, 'WORKSPACE.md', content);
      console.log(
        chalk.green('  ✔'),
        `Generated universal ${chalk.bold('WORKSPACE.md')}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red('  ✖'),
        `Failed to generate universal WORKSPACE.md: ${message}`,
      );
    }
  }

  // Generate base knowledge for each repo if it does not exist (or force recreate if onlyBase is true)
  for (const repo of ctx.repos) {
    if (onlyRepo && repo.name !== onlyRepo) {
      continue;
    }
    const baseExists = await baseFileExists(workspacePath, repo.name, 'nexusflow-knowledge.md');
    if (!baseExists || onlyBase) {
      const baseContent = buildBaseKnowledgeContent(repo.name);
      await writeBaseFile(workspacePath, repo.name, 'nexusflow-knowledge.md', baseContent);
      console.log(
        chalk.green('  ✔'),
        `Generated base knowledge for ${chalk.bold(repo.name)}`,
      );
    } else {
      console.log(
        chalk.gray('  ○'),
        `Base knowledge for ${repo.name} already exists — preserving`,
      );
    }
  }

  if (!onlyBase) {
    try {
      // Generate nexusflow-knowledge.md if it does not exist
      const knowledgeExists = await workspaceFileExists(workspacePath, ctx.feature.id, 'nexusflow-knowledge.md');
      if (!knowledgeExists) {
        const knowledgeContent = buildKnowledgeContent(ctx);
        await writeWorkspaceFile(workspacePath, ctx.feature.id, 'nexusflow-knowledge.md', knowledgeContent);
        console.log(chalk.green('  ✔'), `Generated ${chalk.bold('nexusflow-knowledge.md')} (persistent AI memory)`);
      } else {
        console.log(chalk.gray('  ○'), `nexusflow-knowledge.md already exists — preserving existing content`);
      }

      // Generate Git branch diff context file
      await generateDiffContext(ctx, workspacePath);
      console.log(chalk.green('  ✔'), `Generated ${chalk.bold('nexusflow-diff-context.md')} (incremental git diff)`);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red('  ✖'),
        `Failed to generate workspace context files: ${message}`,
      );
    }
  }

  // Generate per-repo architecture maps
  if (ctx.analysis) {
    const allProduced = new Set<string>();
    for (const [, a] of ctx.analysis) {
      if (a.produces) {
        for (const p of a.produces) {
          allProduced.add(p.name.toLowerCase());
        }
      }
      // Also treat the repository name as a produced package concept
      allProduced.add(a.name.toLowerCase());
    }

    for (const repo of ctx.repos) {
      if (onlyRepo && repo.name !== onlyRepo) {
        continue;
      }
      const a = ctx.analysis.get(repo.path);
      if (a) {
        try {
          const { generateRepoMap } = await import('./map-generator.js');
          await generateRepoMap(repo, a, workspacePath, allProduced);
          console.log(chalk.green('  ✔'), `Generated Architecture Map for ${chalk.bold(repo.name)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red('  ✖'), `Failed to generate Architecture Map for ${repo.name}: ${message}`);
        }
      }
    }
  }

  if (onlyBase) {
    return;
  }

  // Generate configuration for each selected assistant
  for (const assistant of assistants) {
    const entry = GENERATORS[assistant];

    try {
      await entry.generate(ctx, workspacePath);
      console.log(
        chalk.green('  ✔'),
        `Generated ${chalk.bold(entry.outputFile)} for ${assistant}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red('  ✖'),
        `Failed to generate ${entry.outputFile} for ${assistant}: ${message}`,
      );
    }
  }

  // Ensure AGENTS.md is always generated if it is not already generated as a primary assistant file,
  // since it is the universal standard for AI coding agents.
  const hasAgentsGen = assistants.includes('antigravity') || assistants.includes('codex');
  if (!hasAgentsGen) {
    try {
      await generateAntigravityConfig(ctx, workspacePath);
      console.log(
        chalk.green('  ✔'),
        `Generated fallback ${chalk.bold('AGENTS.md')} for harness context`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red('  ✖'),
        `Failed to generate fallback AGENTS.md: ${message}`,
      );
    }
  }


  // Generate implementation plan from dependency analysis (if analysis data available)
  try {
    await generateImplementationPlan(ctx, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate implementation plan: ${message}`,
    );
  }

  // Generate skills files for selected assistants
  try {
    await generateSkills(ctx, assistants, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate skills: ${message}`,
    );
  }
}

// Re-export individual generators for direct use
export { generateClaudeConfig } from './claude.js';
export { generateAntigravityConfig } from './antigravity.js';
export { generateCodexConfig } from './codex.js';
export { generateCopilotConfig } from './copilot.js';
export { generateCursorConfig } from './cursor.js';
export { buildContextContent } from './base.js';
export { generateImplementationPlan } from './plan-generator.js';
