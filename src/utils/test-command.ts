/**
 * @module utils/test-command
 * Maps a repo's detected tech stack to its conventional test command — the
 * single source of the convention, shared by doctor and the context
 * generators.
 */

import type { ProjectAnalysis } from '../types.js';

/**
 * Returns the conventional test command for a repo's primary language.
 */
export function getConventionalTestCommand(analysis: ProjectAnalysis): string {
  const languages = analysis.techStack.languages;
  if (languages.includes('csharp')) return 'dotnet test';
  if (languages.includes('typescript') || languages.includes('javascript')) return 'npm test';
  if (languages.includes('python')) return 'pytest';
  if (languages.includes('go')) return 'go test ./...';
  return 'npm test';
}
