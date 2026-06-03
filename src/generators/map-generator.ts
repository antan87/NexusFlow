/**
 * @module generators/map-generator
 * Generates a nexusflow-map-<repo>.md file for each repository in the workspace.
 * Provides a localized, token-efficient architectural map for AI assistants.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import type { ProjectAnalysis, RepoInfo } from '../types.js';
import { loadConfig } from '../core/config.js';

interface PatternRule {
  name: string;
  label: string;
  regex: RegExp;
  description: string;
}

const LANG_PATTERNS: Record<string, PatternRule[]> = {
  csharp: [
    {
      name: 'FluentValidation',
      label: 'FluentValidation Validator subclasses',
      regex: /:\s*AbstractValidator\s*</g,
      description: 'Used for domain/command validation rules.'
    },
    {
      name: 'MediatR Handlers',
      label: 'MediatR Request Handlers',
      regex: /:\s*IRequestHandler\s*</g,
      description: 'Used for CQRS command/query handler pattern.'
    },
    {
      name: 'MediatR Requests',
      label: 'MediatR Requests/Commands',
      regex: /:\s*IRequest\b(?!Handler)/g,
      description: 'Used for MediatR command/query dispatching.'
    },
    {
      name: 'AutoMapper Profiles',
      label: 'AutoMapper Mapping Profiles',
      regex: /:\s*Profile\b/g,
      description: 'Used for object-to-object mappings.'
    },
    {
      name: 'DataAnnotations',
      label: 'DataAnnotations Validation Attributes',
      regex: /using\s+System\.ComponentModel\.DataAnnotations;/g,
      description: 'Used for property-level attribute validation.'
    }
  ],
  typescript: [
    {
      name: 'Zod Schemas',
      label: 'Zod Object Schemas',
      regex: /z\.object\s*\(/g,
      description: 'Used for schema parsing/validation.'
    },
    {
      name: 'NestJS Controllers',
      label: 'NestJS Routing Controllers',
      regex: /@Controller\s*\(/g,
      description: 'Used for controller routing endpoints.'
    },
    {
      name: 'NestJS Injectables',
      label: 'NestJS Injectable Services',
      regex: /@Injectable\s*\(\)/g,
      description: 'Used for dependency injection services.'
    },
    {
      name: 'React Components',
      label: 'React Functional Components',
      regex: /React\.FC/g,
      description: 'Used for component UI views.'
    }
  ],
  javascript: [
    {
      name: 'Zod Schemas',
      label: 'Zod Object Schemas',
      regex: /z\.object\s*\(/g,
      description: 'Used for schema parsing/validation.'
    }
  ],
  python: [
    {
      name: 'Pydantic Models',
      label: 'Pydantic BaseModel subclasses',
      regex: /class\s+\w+\s*\(\s*BaseModel\s*\)/g,
      description: 'Used for data schemas and validation.'
    },
    {
      name: 'FastAPI Routers',
      label: 'FastAPI APIRouter instances',
      regex: /=([\s\S]*?)APIRouter\s*\(/g,
      description: 'Used for endpoint routing.'
    }
  ],
  go: [
    {
      name: 'Go JSON tags',
      label: 'Go JSON struct tags',
      regex: /`json:"[^"]+"`/g,
      description: 'Used for struct serialization/deserialization.'
    }
  ]
};

/**
 * Generates a `nexusflow-map-<repo>.md` file in the workspace root.
 *
 * @param repo          - The repository metadata.
 * @param analysis      - The repository analysis result.
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateRepoMap(
  repo: RepoInfo,
  analysis: ProjectAnalysis,
  workspacePath: string,
): Promise<void> {
  const repoName = repo.name;
  const worktreePath = path.join(workspacePath, repoName);

  const md: string[] = [];

  md.push(`# Repository Architecture Map — ${repoName}`);
  md.push('');
  md.push(`> **Repository Path**: \`${worktreePath}\``);
  md.push(`> **Generated At**: ${new Date().toISOString()} (UTC)`);
  md.push(`> **Regeneration Command**: Run \`nexusflow sync\` to update this map and workspace planning files.`);
  md.push(`> **Note**: Maps are advisory snapshots of the codebase. Always verify route parameters, patterns, and filenames before relying on them.`);
  md.push('');

  const config = await loadConfig();
  if (config.packContextXml) {
    const contextXmlPath = path.join(workspacePath, `nexusflow-context-${repoName}.xml`).replace(/\\/g, '/');
    md.push(`> **AI-friendly Packed Context**: [nexusflow-context-${repoName}.xml](file:///${contextXmlPath})`);
    md.push(`> — **Instruction**: If you need a complete, AI-friendly XML snapshot of this repository's codebase, read this file.`);
    md.push('');
  }

  // 1. Solution/Project Layout
  md.push('## 🏗️ Project Layout');
  md.push('');

  try {
    const slnFiles = await globby('**/*.sln', {
      cwd: worktreePath,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    const csprojFiles = await globby('**/*.csproj', {
      cwd: worktreePath,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    const packageJsons = await globby('**/package.json', {
      cwd: worktreePath,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    if (slnFiles.length > 0) {
      md.push('### .NET Solutions');
      for (const sln of slnFiles) {
        md.push(`- **Solution**: \`${sln}\``);
      }
      md.push('');
    }

    if (csprojFiles.length > 0) {
      md.push('### .NET Projects');
      for (const csproj of csprojFiles) {
        const isTest = csproj.toLowerCase().includes('test') || csproj.toLowerCase().includes('spec');
        const role = isTest ? 'Test Suite' : 'App/Library';
        md.push(`- \`${csproj}\` (${role})`);
      }
      md.push('');
    }

    if (packageJsons.length > 0) {
      md.push('### npm Packages & Modules');
      for (const pj of packageJsons) {
        md.push(`- \`${pj}\``);
      }
      md.push('');
    }
  } catch {
    md.push('_No project layout files discovered or error occurred._');
    md.push('');
  }

  // 2. Extensible Usage Pattern Scanning
  md.push('## 💡 Detected Architectural Patterns & Usages');
  md.push('');

  const detectedLanguages = analysis.techStack.languages;
  const patternCounts = new Map<string, { label: string; count: number; description: string }>();

  // Initialize counts
  for (const lang of detectedLanguages) {
    const rules = LANG_PATTERNS[lang] || [];
    for (const rule of rules) {
      patternCounts.set(rule.name, { label: rule.label, count: 0, description: rule.description });
    }
  }

  // Scan files for pattern usage
  try {
    const extensions = detectedLanguages.map(l => {
      if (l === 'csharp') return 'cs';
      if (l === 'typescript') return 'ts';
      if (l === 'javascript') return 'js';
      if (l === 'python') return 'py';
      if (l === 'go') return 'go';
      return '';
    }).filter(ext => ext !== '');

    if (extensions.length > 0) {
      const globPattern = extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(',')}}`;
      const srcFiles = await globby(globPattern, {
        cwd: worktreePath,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      });

      for (const file of srcFiles) {
        const fullPath = path.join(worktreePath, file);
        const content = await fs.readFile(fullPath, 'utf-8');

        for (const lang of detectedLanguages) {
          const rules = LANG_PATTERNS[lang] || [];
          for (const rule of rules) {
            rule.regex.lastIndex = 0;
            const matches = content.match(rule.regex);
            if (matches) {
              const val = patternCounts.get(rule.name)!;
              val.count += matches.length;
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  md.push('### Static Analysis Findings');
  if (patternCounts.size > 0) {
    for (const [, v] of patternCounts) {
      md.push(`- **${v.label}**: Found ${v.count} occurrence(s). _(${v.description})_`);
    }
  } else {
    md.push('_No architectural usage patterns detected via static analysis._');
  }
  md.push('');

  md.push('### Packages Present (Dependencies)');
  if (analysis.dependencies.length > 0) {
    for (const dep of analysis.dependencies) {
      md.push(`- \`${dep.name}\` (${dep.version || 'unknown version'})`);
    }
  } else {
    md.push('_No package dependencies detected._');
  }
  md.push('');

  // 3. Endpoint Inventory
  md.push('## 🔌 API Endpoints');
  md.push('');
  if (analysis.endpoints.length > 0) {
    md.push('| Method | Route | Controller/Source File |');
    md.push('|:---|:---|:---|');
    for (const ep of analysis.endpoints) {
      const sourceLink = ep.source
        ? `[${path.basename(ep.source)}](file:///${path.join(worktreePath, ep.source)})`
        : '—';
      md.push(`| \`${ep.method}\` | \`${ep.path}\` | ${sourceLink} |`);
    }
  } else {
    md.push('_No endpoints detected._');
  }
  md.push('');

  // 4. Test Landscape
  md.push('## 🧪 Test Landscape & Command');
  md.push('');
  const testFrameworks: string[] = [];
  let testCommand = '';

  for (const dep of analysis.dependencies) {
    const name = dep.name.toLowerCase();
    if (name.includes('xunit')) testFrameworks.push('xUnit');
    if (name.includes('mstest') || name.includes('microsoft.testplatform')) testFrameworks.push('MSTest');
    if (name.includes('nunit')) testFrameworks.push('NUnit');
    if (name.includes('jest')) testFrameworks.push('Jest');
    if (name.includes('vitest')) testFrameworks.push('Vitest');
    if (name.includes('cypress')) testFrameworks.push('Cypress');
    if (name.includes('playwright')) testFrameworks.push('Playwright');
  }

  if (analysis.techStack.languages.includes('csharp')) {
    testCommand = 'dotnet test';
    try {
      const slns = await globby('**/*.sln', {
        cwd: worktreePath,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      });
      if (slns.length > 0) {
        testCommand = `dotnet test ${slns[0]}`;
      }
    } catch {}
  } else if (analysis.techStack.languages.includes('typescript') || analysis.techStack.languages.includes('javascript')) {
    testCommand = 'npm test';
  }

  if (testFrameworks.length > 0) {
    md.push(`- **Frameworks**: ${testFrameworks.join(', ')}`);
  } else {
    md.push('- **Frameworks**: None explicitly detected');
  }
  if (testCommand) {
    md.push(`- **Run Command**: \`${testCommand}\``);
  }
  md.push('');

  // 5. Custom Skills
  md.push('## 🛠️ Custom Agent Skills');
  md.push('');
  try {
    const skills = await globby('**/SKILL.md', {
      cwd: worktreePath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    if (skills.length > 0) {
      md.push('The following custom agent skills are available in this repository:');
      for (const skill of skills) {
        const relativeSkill = path.relative(worktreePath, skill);
        const skillName = path.basename(path.dirname(skill));
        md.push(`- **${skillName}**: [${relativeSkill}](file:///${skill})`);
      }
    } else {
      md.push('_No custom agent skills found in this repository._');
    }
  } catch {
    md.push('_No custom agent skills found in this repository._');
  }
  md.push('');

  // 6. AI Configurations
  md.push('## 📄 AI Assistant Configurations');
  md.push('');
  if (analysis.existingAIConfigs.length > 0) {
    md.push('Incorporate instructions from these local configurations:');
    for (const config of analysis.existingAIConfigs) {
      md.push(`- [${config.relativePath}](file:///${path.join(worktreePath, config.relativePath)}) (${config.assistant})`);
    }
  } else {
    md.push('_No pre-existing AI configurations found in this repository._');
  }
  md.push('');

  // 7. Project-Specific Conventions (Agent-Defined)
  const conventionsFile = path.join(workspacePath, `nexusflow-conventions-${repoName}.md`);
  let hasConventions = false;
  try {
    await fs.access(conventionsFile);
    hasConventions = true;
  } catch {}

  if (!hasConventions) {
    const starterContent = [
      `# Project Conventions — ${repoName}`,
      '',
      `<!--`,
      `This file is dedicated for the AI assistant and developers to document project-specific conventions.`,
      `Any corrections or guidelines discovered during implementation should be appended here.`,
      `The NexusFlow generator will automatically merge these into the architecture map during sync.`,
      `-->`,
      '',
      `## 📌 Custom Rules & Discovered Conventions`,
      '- ',
    ].join('\n');
    try {
      await fs.writeFile(conventionsFile, starterContent, 'utf-8');
    } catch {}
  }

  let customConventions = '';
  try {
    customConventions = await fs.readFile(conventionsFile, 'utf-8');
  } catch {}

  if (customConventions) {
    md.push('## 📝 Project-Specific Conventions (Agent-Defined)');
    md.push('');
    md.push(customConventions);
    md.push('');
  }

  const outPath = path.join(workspacePath, `nexusflow-map-${repoName}.md`);
  await fs.writeFile(outPath, md.join('\n'), 'utf-8');
}
