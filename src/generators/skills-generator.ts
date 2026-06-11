/**
 * @module generators/skills-generator
 * Generates harness-specific agent skills/rules (e.g. for Claude, Cursor, Copilot, Codex)
 * dynamically based on workspace analysis.
 */

import fse from 'fs-extra';
import * as path from 'node:path';
import type { AIAssistant, WorkspaceContext, ProjectAnalysis } from '../types.js';

/**
 * Checks if the workspace has cross-repo package dependencies.
 */
function hasCrossRepoDependencies(analysis: Map<string, ProjectAnalysis>): boolean {
  const produced = new Set<string>();
  for (const [, a] of analysis) {
    if (a.produces) {
      for (const p of a.produces) {
        produced.add(p.name.toLowerCase());
      }
    }
  }

  for (const [, a] of analysis) {
    for (const dep of a.dependencies) {
      if (produced.has(dep.name.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if any workspace project produces packages that have consumer repos.
 */
function hasProducedPackagesWithConsumers(analysis: Map<string, ProjectAnalysis>): boolean {
  return hasCrossRepoDependencies(analysis); // Same logic: at least one consumer depends on a producer
}

/**
 * Generates local package loop skill instructions.
 */
function getLocalPackageLoopSkill(analysis: Map<string, ProjectAnalysis>): string {
  let pkgManagerInfo = '';
  const hasNuget = Array.from(analysis.values()).some(a => a.techStack.languages.includes('csharp'));
  const hasNpm = Array.from(analysis.values()).some(a => a.techStack.languages.includes('typescript') || a.techStack.languages.includes('javascript'));

  if (hasNuget) {
    pkgManagerInfo += `### NuGet / C# local loop:
1. **Pack locally**: Run \`dotnet pack -c Release -o ./local-packages\` inside the producing project folder.
2. **Add local feed**: Ensure the consumer project's directory has a local NuGet feed configured pointing to the \`local-packages\` directory at the workspace root.
3. **Reference local version**: Update the consumer's package reference in its \`.csproj\` to point to the local version (e.g., \`1.0.0-local\`).
4. **Revert**: Ensure you revert the package reference to the official release version before submitting code.
`;
  }
  if (hasNpm) {
    pkgManagerInfo += `### npm / JS/TS local loop:
1. **Pack locally**: Run \`npm pack\` inside the producing package directory.
2. **Copy / Reference**: Copy the generated \`.tgz\` file to a \`local-packages/\` directory.
3. **Reference local version**: Run \`npm install ../local-packages/my-package-1.0.0.tgz\` or reference it in \`package.json\`.
4. **Revert**: Revert the local reference to the official registry package before submitting code.
`;
  }

  return `# Local Package Development Loop

This skill guides the AI assistant through local package testing across repositories in this workspace.

## Workflow

When modifying a shared package in one repository, you must test its effect on downstream consumer repositories before pushing.

${pkgManagerInfo}

## Guidelines
- **Leave a TODO comment**: Always write a \`// TODO: Revert local package loop reference\` comment in the consumer code so you don't commit temporary local reference modifications.
- **Do not commit local-packages**: The \`local-packages/\` folder is workspace-local and must not be committed to Git.
`;
}

/**
 * Generates release ordering skill instructions.
 */
function getReleaseOrderingSkill(ctx: WorkspaceContext): string {
  const { analysis } = ctx;
  const lines: string[] = [];

  lines.push('# Release and Merge Ordering Guidelines');
  lines.push('');
  lines.push('This guideline answers what repositories must be merged and released in what order when cross-repo dependencies are modified.');
  lines.push('');
  lines.push('## Dependency Chains');

  if (analysis) {
    for (const [path, a] of analysis) {
      if (a.produces && a.produces.length > 0) {
        for (const p of a.produces) {
          const consumers: string[] = [];
          for (const [otherPath, otherA] of analysis) {
            if (otherPath === path) continue;
            for (const dep of otherA.dependencies) {
              if (dep.name.toLowerCase() === p.name.toLowerCase()) {
                consumers.push(otherA.name);
              }
            }
          }
          if (consumers.length > 0) {
            lines.push(`- **Product**: \`${p.name}\``);
            lines.push(`  - **Producer**: \`${a.name}\` (Must build and release first)`);
            lines.push(`  - **Consumers**: ${consumers.map(c => `\`${c}\``).join(', ')} (Must be bumped and released after the producer)`);
          }
        }
      }
    }
  }

  lines.push('');
  lines.push('## Reversion Check');
  lines.push('- Before merging a consumer branch, verify that all local package loop references are replaced by official versions.');

  return lines.join('\n');
}

/**
 * Generates local runtime verifier instructions.
 */
function getVerifierSkill(ctx: WorkspaceContext): string {
  const { analysis } = ctx;
  const lines: string[] = [];

  lines.push('# Workspace Local Runtime Verifier');
  lines.push('');
  lines.push('Guidelines to safely launch, mock, and verify services locally in this workspace.');
  lines.push('');

  let hasInfraWarnings = false;

  if (analysis) {
    for (const [, a] of analysis) {
      if (a.runConfig && a.runConfig.sharedInfraWarnings.length > 0) {
        if (!hasInfraWarnings) {
          lines.push('## ⚠️ Shared Infrastructure Warnings');
          hasInfraWarnings = true;
        }
        for (const warning of a.runConfig.sharedInfraWarnings) {
          lines.push(`- **${a.name}**: ${warning.warning}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('## Verification Recipe');
  lines.push('1. **Check local ports**: Ensure target ports do not conflict.');
  lines.push('2. **Run mocks**: Spin up local databases/caches before starting services.');
  lines.push('3. **Watch out for shared staging environment**: Never publish messages or write data to staging infrastructure while testing locally unless explicitly requested.');

  return lines.join('\n');
}

/**
 * Deploys skills files to the specified harness's directory structure.
 */
async function deploySkill(
  workspacePath: string,
  assistant: AIAssistant,
  skillName: string,
  content: string,
): Promise<void> {
  const titleMap: Record<string, string> = {
    'nexusflow-local-package-loop': 'Local Package Development Loop',
    'nexusflow-release-ordering': 'Release and Merge Ordering',
    'verifier-workspace': 'Local Runtime Verifier',
  };
  const title = titleMap[skillName] || skillName;

  if (assistant === 'claude') {
    const skillDir = path.join(workspacePath, '.claude', 'skills', skillName);
    await fse.ensureDir(skillDir);
    await fse.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  } else if (assistant === 'antigravity') {
    const skillDir = path.join(workspacePath, '.agents', 'skills', skillName);
    await fse.ensureDir(skillDir);
    await fse.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  } else if (assistant === 'cursor') {
    const ruleDir = path.join(workspacePath, '.cursor', 'rules');
    await fse.ensureDir(ruleDir);
    const mdcContent = `---
description: "Guidelines and instructions for ${title}"
alwaysApply: false
---

${content}`;
    await fse.writeFile(path.join(ruleDir, `${skillName}.mdc`), mdcContent, 'utf-8');
  } else if (assistant === 'copilot') {
    const copilotDir = path.join(workspacePath, '.github', 'instructions');
    await fse.ensureDir(copilotDir);
    await fse.writeFile(path.join(copilotDir, `${skillName}.instructions.md`), content, 'utf-8');
  } else if (assistant === 'codex') {
    const codexDir = path.join(workspacePath, '.codex', 'skills', skillName);
    await fse.ensureDir(codexDir);
    await fse.writeFile(path.join(codexDir, 'SKILL.md'), content, 'utf-8');
  }
}

/**
 * Generates custom skills/rules for each selected AI assistant.
 *
 * @param ctx           - The workspace context.
 * @param assistants    - The active AI assistant harnesses.
 * @param workspacePath - The workspace root directory.
 */
export async function generateSkills(
  ctx: WorkspaceContext,
  assistants: AIAssistant[],
  workspacePath: string,
): Promise<void> {
  const { analysis } = ctx;
  if (!analysis) return;

  const hasDeps = hasCrossRepoDependencies(analysis);
  const hasProds = hasProducedPackagesWithConsumers(analysis);
  const hasRunConfig = Array.from(analysis.values()).some(a => a.runConfig && a.runConfig.entryPoints.length > 0);

  const skillsToDeploy: { name: string; content: string }[] = [];

  if (hasDeps) {
    skillsToDeploy.push({
      name: 'nexusflow-local-package-loop',
      content: getLocalPackageLoopSkill(analysis),
    });
  }

  if (hasProds) {
    skillsToDeploy.push({
      name: 'nexusflow-release-ordering',
      content: getReleaseOrderingSkill(ctx),
    });
  }

  if (hasRunConfig) {
    skillsToDeploy.push({
      name: 'verifier-workspace',
      content: getVerifierSkill(ctx),
    });
  }

  for (const assistant of assistants) {
    for (const skill of skillsToDeploy) {
      try {
        await deploySkill(workspacePath, assistant, skill.name, skill.content);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ✖ Failed to deploy skill ${skill.name} for ${assistant}: ${msg}`);
      }
    }
  }
}
