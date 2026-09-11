import { describe, it, expect } from 'vitest';
import { getConventionalTestCommand, getConventionalTestCommands } from './test-command.js';
import type { ProjectAnalysis } from '../types.js';

function analysisFor(languages: string[], buildTools: string[] = []): ProjectAnalysis {
  return {
    name: 'test-repo',
    path: '/path/to/test-repo',
    techStack: { languages: languages as any, frameworks: [], buildTools, projectType: 'backend' },
    dependencies: [],
    ports: [],
    existingAIConfigs: [],
    readmeSummary: '',
  } as unknown as ProjectAnalysis;
}

describe('getConventionalTestCommands', () => {
  it('detects npm test for TypeScript repositories', () => {
    const analysis = analysisFor(['typescript']);
    expect(getConventionalTestCommands(analysis)).toEqual(['npm test']);
  });

  it('detects npm test for JavaScript repositories', () => {
    const analysis = analysisFor(['javascript']);
    expect(getConventionalTestCommands(analysis)).toEqual(['npm test']);
  });

  it('detects dotnet test for C# repositories', () => {
    const analysis = analysisFor(['csharp']);
    expect(getConventionalTestCommands(analysis)).toEqual(['dotnet test']);
  });

  it('detects pytest for Python repositories', () => {
    const analysis = analysisFor(['python']);
    expect(getConventionalTestCommands(analysis)).toEqual(['pytest']);
  });

  it('detects go test for Go repositories', () => {
    const analysis = analysisFor(['go']);
    expect(getConventionalTestCommands(analysis)).toEqual(['go test ./...']);
  });

  it('detects cargo test for Rust repositories', () => {
    const analysis = analysisFor(['rust']);
    expect(getConventionalTestCommands(analysis)).toEqual(['cargo test']);
  });

  it('detects maven or gradle test for Java repositories', () => {
    expect(getConventionalTestCommands(analysisFor(['java'], ['gradle']))).toEqual(['./gradlew test']);
    expect(getConventionalTestCommands(analysisFor(['java'], ['maven']))).toEqual(['mvn test']);
  });

  it('puts fast gate first in mixed C# and TypeScript repositories', () => {
    const analysis = analysisFor(['csharp', 'typescript']);
    const commands = getConventionalTestCommands(analysis);
    expect(commands).toEqual(['npm test', 'dotnet test']);
  });

  it('puts fast gate first in mixed Python and JavaScript repositories', () => {
    const analysis = analysisFor(['python', 'javascript']);
    const commands = getConventionalTestCommands(analysis);
    expect(commands).toEqual(['npm test', 'pytest']);
  });

  it('falls back to npm test for unknown languages or empty analysis', () => {
    expect(getConventionalTestCommands(analysisFor([]))).toEqual(['npm test']);
    expect(getConventionalTestCommands(analysisFor(['other']))).toEqual(['npm test']);
  });

  it('deduplicates npm test if both typescript and javascript are present', () => {
    const analysis = analysisFor(['typescript', 'javascript']);
    expect(getConventionalTestCommands(analysis)).toEqual(['npm test']);
  });
});

describe('getConventionalTestCommand', () => {
  it('returns the fast gate command when multiple commands exist', () => {
    const analysis = analysisFor(['csharp', 'typescript']);
    expect(getConventionalTestCommand(analysis)).toBe('npm test');
  });

  it('returns dotnet test for pure C# repository', () => {
    const analysis = analysisFor(['csharp']);
    expect(getConventionalTestCommand(analysis)).toBe('dotnet test');
  });
});
