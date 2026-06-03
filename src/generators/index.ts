import chalk from 'chalk';
import path from 'node:path';
import fse from 'fs-extra';
import type { AIAssistant, WorkspaceContext } from '../types.js';
import { generateClaudeConfig } from './claude.js';
import { generateCodexConfig } from './codex.js';
import { generateCopilotConfig } from './copilot.js';
import { generateCursorConfig } from './cursor.js';
import { buildContextContent } from './base.js';
import { generateImplementationPlan } from './plan-generator.js';
import { generateWorkspaceGraphFiles } from '../core/graph.js';

/** Maps each assistant to its generator function and the file it produces. */
const GENERATORS: Record<
  AIAssistant,
  {
    generate: (ctx: WorkspaceContext, workspacePath: string) => Promise<void>;
    outputFile: string;
  }
> = {
  claude: { generate: generateClaudeConfig, outputFile: 'CLAUDE.md' },
  antigravity: { generate: generateClaudeConfig, outputFile: 'CLAUDE.md' },
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

## Open Questions

<!-- Add questions that need human input before the AI can proceed. -->

_(No open questions.)_
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
): Promise<void> {
  // Always generate a universal WORKSPACE.md at the workspace root
  try {
    const content = buildContextContent(ctx);
    const filePath = path.join(workspacePath, 'WORKSPACE.md');
    await fse.writeFile(filePath, content, 'utf-8');
    console.log(
      chalk.green('  ✔'),
      `Generated universal ${chalk.bold('WORKSPACE.md')}`,
    );

    // Generate nexusflow-knowledge.md if it does not exist
    const knowledgePath = path.join(workspacePath, 'nexusflow-knowledge.md');
    if (!(await fse.pathExists(knowledgePath))) {
      const knowledgeContent = buildKnowledgeContent(ctx);
      await fse.writeFile(knowledgePath, knowledgeContent, 'utf-8');
      console.log(chalk.green('  ✔'), `Generated ${chalk.bold('nexusflow-knowledge.md')} (persistent AI memory)`);
    } else {
      console.log(chalk.gray('  ○'), `nexusflow-knowledge.md already exists — preserving existing content`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate universal context files: ${message}`,
    );
  }

  // Generate per-repo architecture maps
  if (ctx.analysis) {
    for (const repo of ctx.repos) {
      const a = ctx.analysis.get(repo.path);
      if (a) {
        try {
          const { generateRepoMap } = await import('./map-generator.js');
          await generateRepoMap(repo, a, workspacePath);
          console.log(chalk.green('  ✔'), `Generated Architecture Map for ${chalk.bold(repo.name)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red('  ✖'), `Failed to generate Architecture Map for ${repo.name}: ${message}`);
        }
      }
    }
  }

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

  // Generate Workspace Architecture Graph
  try {
    await generateWorkspaceGraphFiles(ctx, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate workspace architecture graph: ${message}`,
    );
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
}

// Re-export individual generators for direct use
export { generateClaudeConfig } from './claude.js';
export { generateCodexConfig } from './codex.js';
export { generateCopilotConfig } from './copilot.js';
export { generateCursorConfig } from './cursor.js';
export { buildContextContent } from './base.js';
export { generateImplementationPlan } from './plan-generator.js';
