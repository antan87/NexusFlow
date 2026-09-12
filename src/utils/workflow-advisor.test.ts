import { describe, it, expect } from 'vitest';
import { suggestWorkflow } from './workflow-advisor.js';
import type { RepoInfo } from '../types.js';

describe('suggestWorkflow', () => {
  const singleRepo: RepoInfo[] = [
    { name: 'my-service', path: '/dev/my-service', defaultBranch: 'main' },
  ];
  const multiRepos: RepoInfo[] = [
    { name: 'core', path: '/dev/core', defaultBranch: 'main' },
    { name: 'web', path: '/dev/web', defaultBranch: 'main' },
    { name: 'api', path: '/dev/api', defaultBranch: 'main' },
  ];

  it('suggests solo-developer for simple bug fixes and tweaks', async () => {
    const result = await suggestWorkflow('Fix typo in README and tweak button color', singleRepo);
    expect(result.difficulty).toBe('simple');
    expect(result.suggestedWorkflowId).toBe('solo-developer');
    expect(result.customInstructions).toContain('Solo Developer');
  });

  it('suggests research-verify for moderate features', async () => {
    const result = await suggestWorkflow('Implement user notification preferences', singleRepo);
    expect(result.difficulty).toBe('moderate');
    expect(result.suggestedWorkflowId).toBe('research-verify');
    expect(result.customInstructions).toContain('Research & Verify');
  });

  it('suggests plan-implement-review for complex architectural changes', async () => {
    const result = await suggestWorkflow('Refactor authentication architecture and migrate tokens', multiRepos);
    expect(result.difficulty).toBe('complex');
    expect(result.suggestedWorkflowId).toBe('plan-implement-review');
    expect(result.customInstructions).toContain('Plan, Implement, Review');
  });

  it('suggests epic-multi-slice for large epics and multi-PR modules', async () => {
    const result = await suggestWorkflow('New billing module epic broken down into multi-PR slices', singleRepo);
    expect(result.difficulty).toBe('complex');
    expect(result.suggestedWorkflowId).toBe('epic-multi-slice');
    expect(result.customInstructions).toContain('Epic & Multi-PR Slices');
    expect(result.rationale).toContain('epic');
  });
});
