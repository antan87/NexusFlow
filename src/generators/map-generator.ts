/**
 * @module generators/map-generator
 * Generates a nexusflow-map-<repo>.md file for each repository in the workspace.
 * Provides a localized, token-efficient architectural map for AI assistants.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import { writeBaseFile, readBaseFile, baseFileExists } from '../core/storage.js';
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
  // RepoInfo.path is already mode-correct: the worktree inside the workspace,
  // or the source repository for in-place features.
  const worktreePath = repo.path;

  const md: string[] = [];

  md.push(`# Repository Architecture Map — ${repoName}`);
  md.push('');
  md.push(`> **Repository Path**: \`${worktreePath}\``);
  md.push(`> **Generated At**: ${new Date().toISOString()} (UTC)`);
  md.push(`> **Regeneration Command**: Run \`nexusflow refresh\` to update this map.`);
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

  // The Messaging Topology section used to live here. It was removed along with
  // its analyzer: a `\badd\(['"]literal` regex reported every `Set.add('x')` as
  // a queue publisher, so 82% of its rows were string literals from this repo's
  // own source — including the analyzer's own doc comments. An assistant reading
  // the code describes the real topology; a regex over call syntax cannot.

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

  // The API Endpoints section was removed along with its analyzer. Matching
  // `.get('literal')` cannot distinguish a route from a Map lookup or a header
  // read, so 6 of the 7 rows it produced for this repo were false positives —
  // "content-type", "access-control-allow-origin", "local" — and the single real
  // row collapsed 56 hono routes to "/" via a common-prefix walk, destroying the
  // only information it had. An assistant reads the routes directly.

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

  // 7. Project-Specific Conventions — pointed at, never inlined.
  //
  // This file is legacy: nothing has ever written to it, and the concept now
  // belongs to the base knowledge file ("Coding Conventions & Invariants" and
  // "Discovered Gotchas & Watch-outs"), which is where `nexusflow knowledge add`
  // puts things. Older workspaces still carry a copy, so it is still surfaced —
  // but as a link.
  //
  // Inlining it was a persistent source of bugs. Its own `## Coding Patterns`
  // became a sibling of every map section and split this one in two; its
  // `<!-- E.g. … -->` comments and prose preamble both read as facts, so a file
  // of nothing but placeholders survived pruning; and the body went in as a
  // single multi-line array element, which line-based pruning cannot inspect at
  // all — that last one made a file with real content vanish instead. A link has
  // none of those failure modes and costs one line.
  // Linked only when it holds a fact. Every legacy copy is pure scaffolding, and
  // pointing an assistant at a file of placeholders costs it a read to learn
  // nothing — the specific complaint two evaluating agents made about this
  // workspace. Deciding whether a file is worth linking is the right place for
  // this check; trying to structurally prune its markdown after inlining was not.
  const conventionsFilename = `nexusflow-conventions-${repoName}.md`;

  if (await hasRecordedConventions(workspacePath, repoName, conventionsFilename)) {
    md.push('## 📝 Discovered Conventions');
    md.push('');
    md.push(`- Recorded for this repo in \`${conventionsFilename}\`, beside this map.`);
    md.push('');
  }

  await writeBaseFile(
    workspacePath,
    repoName,
    `nexusflow-map-${repoName}.md`,
    pruneEmptySections(md).join('\n'),
  );
}

/**
 * Whether a legacy conventions file actually records something.
 *
 * Conventions are written as list items, so that is what counts — anything that
 * is not a bullet is a heading, a guidance comment, or the starter's prose
 * preamble ("Use this file to record …"), all of which appear in a file nobody
 * has touched. Testing for a non-placeholder bullet is what separates the two.
 */
async function hasRecordedConventions(
  workspacePath: string,
  repoName: string,
  filename: string,
): Promise<boolean> {
  if (!(await baseFileExists(workspacePath, repoName, filename))) return false;
  try {
    const body = await readBaseFile(workspacePath, repoName, filename);
    return body
      .split(/\r?\n/)
      .some((line) => {
        const text = line.trim();
        return /^([-*+]|\d+\.)\s/.test(text) && !isPlaceholderLine(text);
      });
  } catch {
    return false;
  }
}

/**
 * A line that carries no fact about the repository.
 *
 * Covers both "nothing was detected" markers and the `<!-- E.g. … -->` guidance
 * comments that template files leave behind: those are instructions to a future
 * author, so a section holding only comments is as empty as one holding only
 * `_No … detected._`, and was being kept because a comment is not a placeholder.
 */
function isPlaceholderLine(line: string): boolean {
  const text = line.trim();
  return /^_No .*_$/.test(text)
    || text === '- None recorded yet.'
    || /^_No .*\._$/.test(text)
    || /^<!--[\s\S]*-->$/.test(text)
    || text.startsWith('<!--')
    || text.endsWith('-->');
}

/**
 * Drops every heading whose body states only the absence of something.
 *
 * Six of this map's nine sections were `_No … detected._` for a real repo, so
 * most of the file said nothing — while the context file instructed the agent to
 * read it before touching the repository. Pruning at assembly time handles every
 * section uniformly, including ones added later, rather than making each emitter
 * conditional.
 *
 * Deepest level first, because a `## ` section can be half-useful: "Detected
 * Architectural Patterns" held an empty `### Static Analysis Findings` beside a
 * `### Packages Present` that listed a real dependency, so pruning only at `## `
 * granularity kept the placeholder. Removing subsections first also lets a
 * parent become empty and be dropped in turn.
 */
export function pruneEmptySections(lines: string[]): string[] {
  // Split any entry that is itself several lines. Emitters push whole blocks as
  // one array element, and a block starting with a heading then read as a single
  // heading line — which silently deleted sections that did have content.
  const flat = lines.flatMap((line) => (line.includes('\n') ? line.split('\n') : [line]));
  return pruneHeadingLevel(pruneHeadingLevel(flat, 3), 2);
}

/** Drops headings at exactly `depth` whose body carries no fact of its own. */
function pruneHeadingLevel(lines: string[], depth: number): string[] {
  const marker = `${'#'.repeat(depth)} `;
  const headingDepth = (line: string): number => /^(#{1,6})\s/.exec(line.trim())?.[1]?.length ?? 0;

  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.startsWith(marker)) {
      out.push(line);
      index += 1;
      continue;
    }

    // The section runs until the next heading at this level or shallower.
    let end = index + 1;
    while (end < lines.length) {
      const nextDepth = headingDepth(lines[end]!);
      if (nextDepth > 0 && nextDepth <= depth) break;
      end += 1;
    }

    // Nested headings are structure, not facts — a section of nothing but
    // sub-headings says as little as an empty one.
    const hasFacts = lines
      .slice(index + 1, end)
      .some((entry) => entry.trim() !== '' && !isPlaceholderLine(entry) && headingDepth(entry) === 0);

    if (hasFacts) out.push(...lines.slice(index, end));
    index = end;
  }

  return out;
}
