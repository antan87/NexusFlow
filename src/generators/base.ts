/**
 * @module generators/base
 * Builds the shared markdown context content that all AI assistant generators
 * use as their foundation. Now includes rich project analysis data when available.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { WorkspaceContext, ProjectAnalysis } from '../types.js';

/**
 * Formats a ProjectAnalysis into a readable markdown section.
 */
function formatProjectSection(analysis: ProjectAnalysis, workspacePath: string): string {
  const lines: string[] = [];

  lines.push(`### ${analysis.name}`);

  const mapPath = path.join(workspacePath, `nexusflow-map-${analysis.name}.md`).replace(/\\/g, '/');
  lines.push(`- **Architecture Map**: [nexusflow-map-${analysis.name}.md](file:///${mapPath}) — **Instruction**: Before modifying this repository, read its architecture map. For exploration, consult the map's section index on demand.`);

  // Tech stack
  const { techStack } = analysis;
  if (techStack.languages.length > 0 && techStack.languages[0] !== 'other') {
    const langStr = techStack.languages.join(', ');
    const fwStr = techStack.frameworks.length > 0 ? techStack.frameworks.join(', ') : 'none detected';
    const buildStr = techStack.buildTools.length > 0 ? techStack.buildTools.join(', ') : 'none detected';

    lines.push(`- **Type**: ${techStack.projectType}`);
    lines.push(`- **Languages**: ${langStr}`);
    lines.push(`- **Frameworks**: ${fwStr}`);
    lines.push(`- **Build tools**: ${buildStr}`);
  }

  // README summary
  if (analysis.readmeSummary) {
    // Take first 200 chars of README summary as purpose
    const purpose = analysis.readmeSummary
      .replace(/^#\s+.+\n?/, '') // Remove h1 title
      .trim()
      .slice(0, 200)
      .trim();
    if (purpose) {
      lines.push(`- **Purpose**: ${purpose}`);
    }
  }

  // API endpoints
  if (analysis.endpoints.length > 0) {
    lines.push(`- **API surface**: ${analysis.endpoints.length} endpoints — see architecture map for details`);
  }

  // Ports
  if (analysis.ports.length > 0) {
    const portStr = analysis.ports.map((p) => `${p.port} (${p.protocol}, from ${p.source})`).join(', ');
    lines.push(`- **Ports**: ${portStr}`);
  }

  // Path
  lines.push(`- **Path**: \`${analysis.path}\``);

  return lines.join('\n');
}

/**
 * Builds the shared markdown context content that all AI assistant generators
 * use as their foundation. Includes analysis data if available.
 *
 * @param ctx - The workspace context containing feature metadata, repo list, and optional analysis.
 * @returns A markdown string with feature details, repo listing, and task instructions.
 */
export function buildContextContent(ctx: WorkspaceContext): string {
  const { feature, repos, analysis } = ctx;
  const workspacePath = feature.workspacePath;
  const localLlmEnabled = feature.localLlmEnabled ?? false;

  // Build project sections — rich if analysis is available, simple if not
  let projectSections: string;

  if (analysis && analysis.size > 0) {
    const sections = repos.map((r) => {
      const a = analysis.get(r.path);
      if (a) return formatProjectSection(a, workspacePath);
      return `### ${r.name}\n- **Path**: \`${r.path}\``;
    });
    projectSections = sections.join('\n\n');
  } else {
    projectSections = repos
      .map((r) => `- **${r.name}** — \`${r.path}\` (default branch: \`${r.defaultBranch}\`)`)
      .join('\n');
  }

  // Build existing AI configs section
  let existingConfigsSection = '';
  if (analysis && analysis.size > 0) {
    const allConfigs: string[] = [];
    for (const [, a] of analysis) {
      for (const config of a.existingAIConfigs) {
        allConfigs.push(`- **${a.name}** has \`${config.relativePath}\` (${config.assistant})`);
      }
    }
    if (allConfigs.length > 0) {
      existingConfigsSection = `
---

## Existing AI Configurations

The following repos already have AI assistant configuration files.
Incorporate their instructions when working in those repos:

${allConfigs.join('\n')}
`;
    }
  }

  // Resumption commands section
  let resumptionSection = '';
  if (feature.resumption) {
    let { testCommand, mockCommand, startCommand } = feature.resumption;
    const parts: string[] = [];
    if (mockCommand) parts.push(`- **Setup/Mock Command**: \`${mockCommand}\``);
    if (startCommand) parts.push(`- **Start/Run Command**: \`${startCommand}\``);
    
    const standardCommands = [
      'npm run test', 'npm test', 'npm t', 'yarn test', 'yarn t', 'pnpm test', 'pnpm t', 'bun test',
      'dotnet test',
      'pytest', 'python -m unittest', 'python -m pytest',
      'go test', 'go test ./...',
      'cargo test',
    ];

    if (testCommand) {
      const normalizedCmd = testCommand.trim().toLowerCase();
      const isStandard = standardCommands.some(cmd => normalizedCmd === cmd || normalizedCmd.startsWith(cmd + ' '));
      if (!isStandard) {
        parts.push(`- **Verification/Test Command**: \`${testCommand}\``);
      }
    }

    if (parts.length > 0) {
      resumptionSection = `
---

## Workspace Resumption & Verification Commands

Use these pre-configured commands to spin up mocks, run background services, and verify your changes:

${parts.join('\n')}
`;
    }
  }

  const knowledgePath = path.join(workspacePath, 'nexusflow-knowledge.md').replace(/\\/g, '/');

  let setupDone = false;
  try {
    const realKnowledgePath = path.join(workspacePath, 'nexusflow-knowledge.md');
    if (fs.existsSync(realKnowledgePath)) {
      const content = fs.readFileSync(realKnowledgePath, 'utf-8');
      if (!content.includes('No assumptions recorded yet') && !content.includes('AI assistant to populate')) {
        setupDone = true;
      }
    }
  } catch {}

  const taskSection = setupDone
    ? `## Setup Status\n\n✅ **Setup Completed**: Project assumptions and initial questions have been addressed. Refer to [nexusflow-knowledge.md](file:///${knowledgePath}) for persistent session details.`
    : `## First Steps\n\nYour very first task upon entering this workspace is to explore the codebase and align with the user:\n\n1. **Verify Assumptions**: Open [nexusflow-knowledge.md](file:///${knowledgePath}) and fill in the **Project Assumptions** section with a brief description of what each project does, its tech stack, and responsibilities.\n2. **Raise Questions**: Document any outstanding uncertainties or architectural questions in the **Clarifying Questions for the User** section.\n3. **Obtain Approval**: Ask the user to confirm your assumptions and answer your questions before writing any code.`;

  // Note: In the template below, \${feature.branchName} on the 'Multi-Repo Workspace Structure'
  // guideline line is intentionally escaped to render as a literal placeholder in the AI-facing output.
  return `# Multi-Repo Workspace Context

## Feature: ${feature.id}

**Description:** ${feature.description}

> For the detailed feature specification, architecture decisions, and session memory, see [nexusflow-knowledge.md](file:///${knowledgePath}).

---

## Projects

This workspace contains the following projects, each checked out as a
git worktree on the feature branch:

${projectSections}
${existingConfigsSection}
${resumptionSection}
---

${taskSection}
---

## Guidelines

- **Multi-Repo Workspace Structure**: This workspace is a multi-repository developer environment where each project subdirectory (e.g. \`my-api\`, \`my-frontend\`) is a separate Git worktree checked out on the feature branch \`\${feature.branchName}\`.
  - **All code changes** must be made within the appropriate project subdirectories.
  - **Worktree Isolation**: Under no circumstances should you edit files, read code, or run commands in the original/main repository directories outside of this workspace folder. All development must be strictly contained within the checked-out worktree subdirectories of this workspace.
  - **Git commands** (like \`git status\`, \`git add\`, \`git commit\`, \`git push\`) must be run inside the specific project subdirectories (e.g. \`cd my-api && git commit -m "..."\`), NOT in the workspace root.
  - **Project commands** (like \`npm install\`, \`npm run build\`, \`npm run test\`) must be run inside the project subdirectories.
  - **Global helpers**: Alternatively, you can run NexusFlow CLI commands from the workspace root:
    - \`nexusflow diff\` — view changes across all sub-repositories.
    - \`nexusflow commit\` — commit and push changes across modified repositories.
    - \`nexusflow sync\` — rebase all repositories with their default base branches.
    - \`nexusflow refresh\` — regenerate maps, context files and plans without rebasing.
    - \`nexusflow doctor\` — run diagnostics to verify workspace health.
- **Workspace Knowledge**: Read \`nexusflow-knowledge.md\` at the start of every session. It serves as the persistent memory for this feature. Before ending your session, append significant architecture decisions, discovered gotchas, and checklist progress to \`nexusflow-knowledge.md\`. Never delete or overwrite existing knowledge/decisions — only append.
- **Implementation Plan**: Refer to \`nexusflow-plan.md\` for the suggested implementation order based on dependency analysis. Follow the phased implementation order to avoid blocking yourself on cross-repo dependencies.
${localLlmEnabled ? `- **Local AI Agent Delegation (Token Optimizer)**: You have access to a local Small Language Model (SLM) on the developer's machine via the MCP tool \`delegate_to_local_agent\`.${
  ctx.localLlm ? `\n  - **Model Capacity**: The local agent is running \`${ctx.localLlm.model}\`. ${
    ctx.localLlm.model.match(/70b|72b|32b|14b/i)
      ? 'This is a highly capable model; you can delegate complex reasoning and larger code generation tasks.'
      : 'This is a smaller model; it is best suited for targeted search, log parsing, summarization, and simple boilerplate.'
  }` : ''
}
  - **Usage rule**: Whenever you need to perform high-token tasks (like searching large chunks of code, analyzing raw service logs to debug, or generating repetitive boilerplate), **always use \`delegate_to_local_agent\`** first.
  - The local model is free and fast. Pass the instruction and any logs/source files in \`filesToRead\` (relative paths). Use the distilled summary returned to formulate your final output, saving up to 90% in remote context tokens.
` : ''}- Read each project's existing \`README.md\` and any doc files before proposing changes.
- When modifying a shared library, check every downstream consumer for breakage.
- Prefer small, focused commits that touch one repo at a time when possible.
- If a change must span repos, describe the ordering and any migration steps.




`;
}
