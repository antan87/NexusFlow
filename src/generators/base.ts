/**
 * @module generators/base
 * Builds the shared markdown context content that all AI assistant generators
 * use as their foundation. Now includes rich project analysis data when available.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { WorkspaceContext, ProjectAnalysis } from '../types.js';

/**
 * Formats a ProjectAnalysis into a readable markdown section.
 */
function formatProjectSection(analysis: ProjectAnalysis, workspacePath: string): string {
  const lines: string[] = [];

  lines.push(`### ${analysis.name}`);

  const mapPath = path.join(workspacePath, `nexusflow-map-${analysis.name}.md`).replace(/\\/g, '/');
  lines.push(`- **Architecture Map**: [nexusflow-map-${analysis.name}.md](file:///${mapPath}) — **Instruction**: You MUST read this architecture map before exploring or modifying the \`${analysis.name}\` repository to understand its layout, API endpoints, test commands, and detected usage patterns.`);

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
    lines.push(`- **API endpoints** (${analysis.endpoints.length} detected):`);
    // Show up to 10 endpoints
    const shown = analysis.endpoints.slice(0, 10);
    for (const ep of shown) {
      lines.push(`  - \`${ep.method} ${ep.path}\``);
    }
    if (analysis.endpoints.length > 10) {
      lines.push(`  - _...and ${analysis.endpoints.length - 10} more_`);
    }
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
    
    if (testCommand) {
      if (testCommand === 'npm run test') {
        const hasJs = repos.some(r => {
          const a = analysis?.get(r.path);
          return a?.techStack.languages.includes('typescript') || a?.techStack.languages.includes('javascript');
        });
        const hasCsharp = repos.some(r => {
          const a = analysis?.get(r.path);
          return a?.techStack.languages.includes('csharp');
        });

        if (hasCsharp && !hasJs) {
          testCommand = 'dotnet test';
        } else if (!hasJs && !hasCsharp) {
          testCommand = undefined;
        }
      }
      if (testCommand) {
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

  // Check if overview.md already exists
  const overviewFile = path.join(workspacePath, 'nexusflow-overview.md');
  const hasOverview = fs.existsSync(overviewFile);

  let taskSection = '';
  if (hasOverview) {
    taskSection = `## Task & Step-by-Step Maintenance

The universal reference file **\`nexusflow-overview.md\`** has already been created. Your task is to:

1. **Keep it Updated**: Maintain and update \`nexusflow-overview.md\` with any new architectural findings, layout changes, or assumptions.
2. **Review Assumptions**: Ensure that inter-repo relationships and package dependencies documented there reflect the current codebase.
3. **Address Open Questions**: If there are outstanding items in the "Clarifying Questions for the User" section, discuss them with the user.
`;
  } else {
    taskSection = `## Task & Step-by-Step Initialization

Your very first task upon entering this workspace is to analyze the codebase and document it in a universal reference file:

1. **Create \`nexusflow-overview.md\`** at the workspace root.
2. **Project Assumptions**: For each project, write down a clear assumption of what it does, its primary tech stack, and its core responsibilities.
3. **Inter-Repo Relationships**: Document how the repos relate:
   - Shared libraries/packages (producers and consumers).
   - API boundaries (which repos expose APIs, which ones consume them).
   - Data flows and dependencies.
4. **Clarifying Questions**: If any feature requirements, architectural patterns, or API contracts are unclear, list them explicitly under a section called **"Clarifying Questions for the User"**.
5. **Universal Reference**: Keep this file updated. This acts as a universal reference so that any LLM assistant (Claude, Antigravity, Codex, Cursor, Copilot) joining this workspace instantly understands the project landscape.

Once you have created \`nexusflow-overview.md\` and compiled your questions, ask the user to verify your assumptions and answer your questions before proceeding to write code.
`;
  }

  const knowledgePath = path.join(workspacePath, 'nexusflow-knowledge.md').replace(/\\/g, '/');

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
- **Workspace Knowledge**: Read \`nexusflow-knowledge.md\` at the start of every session. It serves as the persistent memory for this feature. Before ending your session, append significant architecture decisions, discovered gotchas, and checklist progress to \`nexusflow-knowledge.md\`. Never delete or overwrite existing knowledge/decisions — only append.
- **Implementation Plan**: Refer to \`nexusflow-plan.md\` for the suggested implementation order based on dependency analysis. Follow the phased implementation order to avoid blocking yourself on cross-repo dependencies.
- Read each project's existing \`README.md\` and any doc files before proposing changes.
- When modifying a shared library, check every downstream consumer for breakage.
- Prefer small, focused commits that touch one repo at a time when possible.
- If a change must span repos, describe the ordering and any migration steps.




`;
}
