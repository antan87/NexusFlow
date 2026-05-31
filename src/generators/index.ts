import chalk from 'chalk';
import path from 'node:path';
import fse from 'fs-extra';
import type { AIAssistant, WorkspaceContext } from '../types.js';
import { generateClaudeConfig } from './claude.js';
import { generateCodexConfig } from './codex.js';
import { generateCopilotConfig } from './copilot.js';
import { generateCursorConfig } from './cursor.js';
import { buildContextContent } from './base.js';

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
 * Generates AI context files for each of the selected assistants.
 *
 * Iterates over the provided assistant list, invokes the corresponding
 * generator, and logs success / failure for each one.
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

    // Generate session.md template if it does not exist
    const sessionPath = path.join(workspacePath, 'session.md');
    if (!(await fse.pathExists(sessionPath))) {
      const sessionContent = `# AI Session Handover Memo

- **Feature Branch**: \`${ctx.feature.branchName}\`
- **Session Started**: ${new Date().toLocaleDateString()}
- **Last Modified Files**: None (Start of session)

## Summary of Accomplished Work
- Setup workspace with ${ctx.repos.length} mapped repositories.

## Active State & Blockers
- No active blockers.

## Next Steps
1. Open this workspace in your selected editor.
2. Ask the assistant to read \`WORKSPACE.md\` and \`session.md\` to get started.
`;
      await fse.writeFile(sessionPath, sessionContent, 'utf-8');
      console.log(chalk.green('  ✔'), `Generated initial session.md`);
    }

    // Generate plan.md template if it does not exist
    const planPath = path.join(workspacePath, 'plan.md');
    if (!(await fse.pathExists(planPath))) {
      const planContent = `# Feature Development Plan

## Checklist
- [ ] Read \`WORKSPACE.md\` and analyze the codebase structure.
- [ ] Initialize context by creating \`nexusflow-overview.md\` outlining assumptions and raising clarifying questions.
- [ ] Review user's responses to clarifying questions.
- [ ] Implement feature logic.
- [ ] Verify build and run tests.
- [ ] Compile final changes in the session handover memo.
`;
      await fse.writeFile(planPath, planContent, 'utf-8');
      console.log(chalk.green('  ✔'), `Generated initial plan.md`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate universal context files: ${message}`,
    );
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
}

// Re-export individual generators for direct use
export { generateClaudeConfig } from './claude.js';
export { generateCodexConfig } from './codex.js';
export { generateCopilotConfig } from './copilot.js';
export { generateCursorConfig } from './cursor.js';
export { buildContextContent } from './base.js';
