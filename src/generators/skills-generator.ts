/**
 * @module generators/skills-generator
 * Generates harness-specific agent skills/rules (e.g. for Claude, Antigravity, Cursor, Copilot, Codex)
 * dynamically based on workspace analysis and workspace skills configuration.
 */

import fse from 'fs-extra';
import * as path from 'node:path';
import type { AIAssistant, WorkspaceContext, ProjectAnalysis, SkillItem } from '../types.js';
import {
  getAllSkills,
  getWorkspaceSkillsConfig,
  serializeSkillMarkdown,
} from '../utils/skills-catalog.js';

/**
 * Checks if the workspace has cross-repo package dependencies.
 */
function hasCrossRepoDependencies(analysis: Map<string, ProjectAnalysis>): boolean {
  const produced = new Set<string>();
  for (const [, a] of analysis) {
    if (a.produces && Array.isArray(a.produces)) {
      for (const p of a.produces) {
        if (p && p.name) {
          produced.add(p.name.toLowerCase());
        }
      }
    }
  }

  for (const [, a] of analysis) {
    if (Array.isArray(a.dependencies)) {
      for (const dep of a.dependencies) {
        if (dep && dep.name && produced.has(dep.name.toLowerCase())) {
          return true;
        }
      }
    } else if (a.dependencies && typeof a.dependencies === 'object') {
      for (const depName of Object.keys(a.dependencies)) {
        if (produced.has(depName.toLowerCase())) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks if any workspace project produces packages that have consumer repos.
 */
function hasProducedPackagesWithConsumers(analysis: Map<string, ProjectAnalysis>): boolean {
  return hasCrossRepoDependencies(analysis);
}

/**
 * Generates local package loop skill instructions.
 */
function getLocalPackageLoopSkill(analysis: Map<string, ProjectAnalysis>): string {
  let pkgManagerInfo = '';
  const hasNuget = Array.from(analysis.values()).some((a) =>
    a.techStack?.languages?.includes('csharp'),
  );
  const hasNpm = Array.from(analysis.values()).some(
    (a) =>
      a.techStack?.languages?.includes('typescript') || a.techStack?.languages?.includes('javascript'),
  );

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
  lines.push(
    'This guideline answers what repositories must be merged and released in what order when cross-repo dependencies are modified.',
  );
  lines.push('');
  lines.push('## Dependency Chains');

  if (analysis) {
    for (const [pathKey, a] of analysis) {
      if (a.produces && a.produces.length > 0) {
        for (const p of a.produces) {
          const consumers: string[] = [];
          for (const [otherPath, otherA] of analysis) {
            if (otherPath === pathKey) continue;
            for (const dep of otherA.dependencies) {
              if (dep.name.toLowerCase() === p.name.toLowerCase()) {
                consumers.push(otherA.name);
              }
            }
          }
          if (consumers.length > 0) {
            lines.push(`- **Product**: \`${p.name}\``);
            lines.push(`  - **Producer**: \`${a.name}\` (Must build and release first)`);
            lines.push(
              `  - **Consumers**: ${consumers.map((c) => `\`${c}\``).join(', ')} (Must be bumped and released after the producer)`,
            );
          }
        }
      }
    }
  }

  lines.push('');
  lines.push('## Reversion Check');
  lines.push(
    '- Before merging a consumer branch, verify that all local package loop references are replaced by official versions.',
  );

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
  lines.push(
    '3. **Watch out for shared staging environment**: Never publish messages or write data to staging infrastructure while testing locally unless explicitly requested.',
  );

  return lines.join('\n');
}

/**
 * Copies or writes supporting references and scripts for a deployed skill.
 */
async function copySkillSupportingFiles(
  targetSkillDir: string,
  skill: SkillItem,
): Promise<void> {
  if (skill.references && skill.references.length > 0) {
    const refDir = path.join(targetSkillDir, 'references');
    await fse.ensureDir(refDir);
    for (const r of skill.references) {
      if (r.name) {
        if (r.content !== undefined) {
          await fse.writeFile(path.join(refDir, r.name), r.content, 'utf-8');
        } else if (skill.sourcePath) {
          const srcFile = path.join(skill.sourcePath, 'references', r.name);
          if (await fse.pathExists(srcFile)) {
            await fse.copy(srcFile, path.join(refDir, r.name));
          }
        }
      }
    }
  }

  if (skill.scripts && skill.scripts.length > 0) {
    const scDir = path.join(targetSkillDir, 'scripts');
    await fse.ensureDir(scDir);
    for (const s of skill.scripts) {
      if (s.name) {
        if (s.content !== undefined) {
          await fse.writeFile(path.join(scDir, s.name), s.content, 'utf-8');
        } else if (skill.sourcePath) {
          const srcFile = path.join(skill.sourcePath, 'scripts', s.name);
          if (await fse.pathExists(srcFile)) {
            await fse.copy(srcFile, path.join(scDir, s.name));
          }
        }
      }
    }
  }
}

/**
 * Deploys an individual skill to a specific assistant's expected directory.
 */
export async function deploySkillItem(
  workspacePath: string,
  assistant: AIAssistant,
  skill: SkillItem,
): Promise<void> {
  const skillName = skill.name || skill.id;
  const title = skill.title || skillName;

  const metadata: Record<string, unknown> = {
    name: skillName,
    title,
    category: skill.category || 'general',
    description: skill.description || `Guidelines for ${title}`,
  };
  if (skill.tags && skill.tags.length > 0) {
    metadata.tags = skill.tags;
  }
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    metadata['allowed-tools'] = skill.allowedTools;
  }

  const fullMarkdownWithFrontmatter = serializeSkillMarkdown(metadata, skill.content);

  if (assistant === 'claude') {
    const skillDir = path.join(workspacePath, '.claude', 'skills', skillName);
    await fse.ensureDir(skillDir);
    await fse.writeFile(path.join(skillDir, 'SKILL.md'), fullMarkdownWithFrontmatter, 'utf-8');
    await copySkillSupportingFiles(skillDir, skill);
  } else if (assistant === 'antigravity') {
    const skillDir = path.join(workspacePath, '.agents', 'skills', skillName);
    await fse.ensureDir(skillDir);
    await fse.writeFile(path.join(skillDir, 'SKILL.md'), fullMarkdownWithFrontmatter, 'utf-8');
    await copySkillSupportingFiles(skillDir, skill);
  } else if (assistant === 'cursor') {
    const ruleDir = path.join(workspacePath, '.cursor', 'rules');
    await fse.ensureDir(ruleDir);
    const mdcContent = `---
description: "${skill.description.replace(/"/g, '\\"') || `Guidelines for ${title}`}"
alwaysApply: false
---

${skill.content}`;
    await fse.writeFile(path.join(ruleDir, `${skillName}.mdc`), mdcContent, 'utf-8');
  } else if (assistant === 'copilot') {
    const copilotDir = path.join(workspacePath, '.github', 'instructions');
    await fse.ensureDir(copilotDir);
    await fse.writeFile(
      path.join(copilotDir, `${skillName}.instructions.md`),
      skill.content,
      'utf-8',
    );
  } else if (assistant === 'codex') {
    const skillDir = path.join(workspacePath, '.codex', 'skills', skillName);
    await fse.ensureDir(skillDir);
    await fse.writeFile(path.join(skillDir, 'SKILL.md'), fullMarkdownWithFrontmatter, 'utf-8');
    await copySkillSupportingFiles(skillDir, skill);
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

  // 1. Get enabled skills config and catalog
  const wsConfig = await getWorkspaceSkillsConfig(workspacePath);
  const catalogSkills = await getAllSkills(workspacePath);
  const skillMap = new Map<string, SkillItem>();

  for (const s of catalogSkills) {
    skillMap.set(s.id, s);
  }

  // 2. Add or update dynamic skills based on codebase analysis
  if (analysis) {
    const hasDeps = hasCrossRepoDependencies(analysis);
    const hasProds = hasProducedPackagesWithConsumers(analysis);
    const hasRunConfig = Array.from(analysis.values()).some(
      (a) => a.runConfig && a.runConfig.entryPoints.length > 0,
    );

    if (hasDeps) {
      skillMap.set('nexusflow-local-package-loop', {
        id: 'nexusflow-local-package-loop',
        name: 'nexusflow-local-package-loop',
        title: 'Local Package Development Loop',
        category: 'cross-repo-release',
        description: 'Guides testing cross-repo package dependencies locally without publishing.',
        content: getLocalPackageLoopSkill(analysis),
        custom: false,
      });
    }

    if (hasProds) {
      skillMap.set('nexusflow-release-ordering', {
        id: 'nexusflow-release-ordering',
        name: 'nexusflow-release-ordering',
        title: 'Release and Merge Ordering Guidelines',
        category: 'cross-repo-release',
        description: 'Answers what repositories must be merged and released in what order.',
        content: getReleaseOrderingSkill(ctx),
        custom: false,
      });
    }

    if (hasRunConfig) {
      skillMap.set('verifier-workspace', {
        id: 'verifier-workspace',
        name: 'verifier-workspace',
        title: 'Local Runtime Verifier',
        category: 'testing-qa',
        description: 'Guidelines to safely launch, mock, and verify services locally.',
        content: getVerifierSkill(ctx),
        custom: false,
      });
    }
  }

  // 3. Determine which skills to deploy
  const skillsToDeploy: SkillItem[] = [];
  const enabledSet = new Set(wsConfig.enabledSkills);

  for (const [id, skill] of skillMap.entries()) {
    if (enabledSet.has(id)) {
      skillsToDeploy.push(skill);
    }
  }


  // 4. Deploy to each target assistant
  for (const assistant of assistants) {
    for (const skill of skillsToDeploy) {
      try {
        await deploySkillItem(workspacePath, assistant, skill);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ✖ Failed to deploy skill ${skill.id} for ${assistant}: ${msg}`);
      }
    }
  }
}
