/**
 * @module generators/map-generator
 * Generates a nexusflow-map-<repo>.md file for each repository in the workspace.
 * Provides a localized, token-efficient architectural map for AI assistants.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import type { ProjectAnalysis, RepoInfo } from '../types.js';

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
  allProducedPackages: Set<string> = new Set(),
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

  // 1.5. Messaging Topology
  md.push('## 📨 Messaging Topology');
  md.push('');
  if (analysis.messaging && (analysis.messaging.publishers.length > 0 || analysis.messaging.subscribers.length > 0)) {
    if (analysis.messaging.publishers.length > 0) {
      md.push('### Publishes');
      md.push('| Message Contract | Topic/Queue/Channel | Publisher (file) |');
      md.push('|---|---|---|');
      for (const p of analysis.messaging.publishers) {
        const fileLink = p.publisherFile
          ? `[${path.basename(p.publisherFile)}](file:///${path.join(worktreePath, p.publisherFile)})`
          : '—';
        md.push(`| ${p.contractType} | ${p.topicOrQueue} | ${fileLink} |`);
      }
      md.push('');
    }

    if (analysis.messaging.subscribers.length > 0) {
      md.push('### Subscribes');
      md.push('| Message Contract | Handler (file) | Registered in |');
      md.push('|---|---|---|');
      for (const s of analysis.messaging.subscribers) {
        const handlerLink = s.handlerFile
          ? `[${path.basename(s.handlerFile)}](file:///${path.join(worktreePath, s.handlerFile)})`
          : '—';
        const regLink = s.registrationFile
          ? `[${path.basename(s.registrationFile)}](file:///${path.join(worktreePath, s.registrationFile)})`
          : '—';
        md.push(`| ${s.contractType} | ${handlerLink} | ${regLink} |`);
      }
      md.push('');
    }
  } else {
    md.push('_No pub/sub messaging patterns detected in this repository._');
    md.push('');
  }

  // 2. Extensible Usage Pattern Scanning
  md.push('## 💡 Detected Architectural Patterns & Usages');
  md.push('');

  const detectedLanguages = analysis.techStack.languages;
  const patternExamples = new Map<string, { label: string; firstFile?: string; description: string }>();

  // Initialize examples
  for (const lang of detectedLanguages) {
    const rules = LANG_PATTERNS[lang] || [];
    for (const rule of rules) {
      patternExamples.set(rule.name, { label: rule.label, description: rule.description });
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
            const val = patternExamples.get(rule.name)!;
            if (val.firstFile) continue; // Already found an example

            rule.regex.lastIndex = 0;
            if (rule.regex.test(content)) {
              val.firstFile = file.replace(/\\/g, '/');
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  md.push('### Static Analysis Findings');
  let hasFindings = false;
  if (patternExamples.size > 0) {
    for (const [, v] of patternExamples) {
      if (v.firstFile) {
        hasFindings = true;
        const fileLink = `[${path.basename(v.firstFile)}](file:///${path.join(worktreePath, v.firstFile).replace(/\\/g, '/')})`;
        md.push(`- **${v.label}** example: ${fileLink} _(${v.description})_`);
      }
    }
  }
  if (!hasFindings) {
    md.push('_No architectural usage patterns detected via static analysis._');
  }
  md.push('');

  md.push('### Packages Present (Dependencies)');
  // Filter dependencies: only show internal packages produced by repos in this workspace,
  // or those matching a common organization namespace prefix (e.g. if one package is MyOrg.Common, then MyOrg.*).
  const internalPrefixes = Array.from(allProducedPackages).map(p => {
    const parts = p.split('.');
    return parts.length > 1 ? parts[0] + '.' : null;
  }).filter((p): p is string => p !== null);

  const filteredDeps = analysis.dependencies.filter(dep => {
    const depNameLower = dep.name.toLowerCase();
    if (allProducedPackages.has(depNameLower)) return true;
    return internalPrefixes.some(prefix => depNameLower.startsWith(prefix));
  });

  if (filteredDeps.length > 0) {
    for (const dep of filteredDeps) {
      md.push(`- \`${dep.name}\` (${dep.version || 'unknown version'})`);
    }
  } else {
    md.push('_No cross-repo or organization-internal package dependencies detected._');
  }
  md.push('');

  // 3. Endpoint Inventory
  md.push('## 🔌 API Endpoints');
  md.push('');
  if (analysis.endpoints.length > 0) {
    md.push('| Endpoint Group (Router/Module/File) | Route Prefix / Pattern | Verbs | Source File |');
    md.push('|:---|:---|:---|:---|');

    // Group endpoints by source file
    const grouped = new Map<string, typeof analysis.endpoints>();
    for (const ep of analysis.endpoints) {
      const src = ep.source || 'Unknown';
      if (!grouped.has(src)) {
        grouped.set(src, []);
      }
      grouped.get(src)!.push(ep);
    }

    const findCommonPrefix = (paths: string[]): string => {
      if (paths.length === 0) return '';
      if (paths.length === 1) return paths[0]!;
      const sorted = [...paths].sort();
      const first = sorted[0]!.split('/');
      const last = sorted[sorted.length - 1]!.split('/');
      const common: string[] = [];
      for (let i = 0; i < first.length; i++) {
        if (first[i] === last[i]) {
          common.push(first[i]!);
        } else {
          break;
        }
      }
      const prefix = common.join('/');
      return prefix || '/';
    };

    for (const [src, eps] of grouped) {
      const groupName = src !== 'Unknown' ? path.basename(src, path.extname(src)) : 'Inferred';
      const paths = eps.map(e => e.path);
      const commonPrefix = findCommonPrefix(paths);
      const verbs = Array.from(new Set(eps.map(e => e.method.toUpperCase()))).join(', ');
      const sourceLink = src !== 'Unknown'
        ? `[${path.basename(src)}](file:///${path.join(worktreePath, src).replace(/\\/g, '/')})`
        : '—';
      md.push(`| ${groupName} | \`${commonPrefix}\` | \`${verbs}\` | ${sourceLink} |`);
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

  // 4.5. Running Locally
  md.push('## ▶️ Running Locally');
  md.push('');
  if (analysis.runConfig) {
    const { entryPoints, databases, sharedInfraWarnings, committedSecrets } = analysis.runConfig;

    if (entryPoints.length > 0) {
      md.push('### Entry Points');
      for (const ep of entryPoints) {
        md.push(`- **${ep.type.toUpperCase()} App**: \`${ep.command || 'dotnet run'}\` (configured in \`${ep.projectPath}\`)`);
      }
      md.push('');
    }

    if (databases.length > 0) {
      md.push('### Databases & Data Stores');
      md.push('| Provider | Target Host | Config File |');
      md.push('|---|---|---|');
      for (const db of databases) {
        md.push(`| ${db.provider} | ${db.host} | \`${db.configFile}\` |`);
      }
      md.push('');
    }

    if (sharedInfraWarnings.length > 0) {
      md.push('### ⚠️ Shared Infrastructure Warnings');
      for (const w of sharedInfraWarnings) {
        md.push(`- ${w.warning}`);
      }
      md.push('');
    }

    if (committedSecrets.length > 0) {
      md.push('### 🔒 Potential Committed Secrets');
      for (const s of committedSecrets) {
        md.push(`- **Warning**: Possible plaintext secret/key/password found in \`${s.file}\` (key hint: \`${s.lineHint}\`)`);
      }
      md.push('');
    }
  } else {
    md.push('_No run configurations detected._');
    md.push('');
  }

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
  md.push('## 📝 Discovered Conventions');
  md.push('');
  
  const conventionsFile = path.join(workspacePath, `nexusflow-conventions-${repoName}.md`);
  let customConventions = '';
  try {
    customConventions = await fs.readFile(conventionsFile, 'utf-8');
    // Strip the title from the old conventions file if present
    customConventions = customConventions.replace(/^#\s+.+\n?/, '').trim();
  } catch {}

  if (customConventions) {
    md.push(customConventions);
    md.push('');
  } else {
    md.push('<!-- AI assistants: Document any project-specific conventions, gotchas, or coding rules discovered here. -->');
    md.push('');
    md.push('- None recorded yet.');
    md.push('');
  }

  const outPath = path.join(workspacePath, `nexusflow-map-${repoName}.md`);
  await fs.writeFile(outPath, md.join('\n'), 'utf-8');
}
