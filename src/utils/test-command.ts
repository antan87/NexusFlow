/**
 * @module utils/test-command
 * Maps a repo's detected tech stack to its conventional test command — the
 * single source of the convention, shared by doctor and the context
 * generators.
 */

import type { ProjectAnalysis } from '../types.js';

/**
 * Returns the conventional test commands for a repo's detected tech stack,
 * ordered with fast gates (e.g. frontend test suites) first followed by backend gates.
 */
export function getConventionalTestCommands(analysis: ProjectAnalysis): string[] {
  const languages = analysis.techStack?.languages ?? [];
  const commands: string[] = [];

  // Fast gate first: frontend/unit test suites in TypeScript/JavaScript run quickly
  if (languages.includes('typescript') || languages.includes('javascript')) {
    commands.push('npm test');
  }
  if (languages.includes('python')) {
    commands.push('pytest');
  }
  if (languages.includes('go')) {
    commands.push('go test ./...');
  }
  if (languages.includes('rust')) {
    commands.push('cargo test');
  }
  if (languages.includes('csharp')) {
    commands.push('dotnet test');
  }
  if (languages.includes('java')) {
    commands.push(analysis.techStack?.buildTools?.includes('gradle') ? './gradlew test' : 'mvn test');
  }

  if (commands.length === 0) {
    commands.push('npm test');
  }

  return Array.from(new Set(commands));
}

/**
 * Returns the primary conventional test command for a repo's primary language.
 * When multiple test commands exist, returns the first (fastest gate).
 */
export function getConventionalTestCommand(analysis: ProjectAnalysis): string {
  const commands = getConventionalTestCommands(analysis);
  return commands[0] ?? 'npm test';
}

