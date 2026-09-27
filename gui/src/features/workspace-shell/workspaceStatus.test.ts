import { describe, expect, it } from 'vitest';
import type { LifecycleStep } from '../../types.js';
import { nextMilestone, verificationText } from './workspaceStatus.js';

const step = (id: string, status: LifecycleStep['status']): LifecycleStep => ({ id, title: id, status });

describe('nextMilestone', () => {
  it('prefers the milestone in progress, then the first unfinished one', () => {
    expect(nextMilestone([step('a', 'completed'), step('b', 'pending'), step('c', 'in_progress')])?.id).toBe('c');
    expect(nextMilestone([step('a', 'verified'), step('b', 'blocked'), step('c', 'pending')])?.id).toBe('b');
    expect(nextMilestone([step('a', 'completed')])).toBeUndefined();
  });
});

describe('verificationText', () => {
  it('reports only recorded evidence', () => {
    expect(verificationText({ overallStatus: 'pass', durationMs: 2400 })).toBe('Verified (2.4s)');
    expect(verificationText({ overallStatus: 'pass' })).toBe('Verified');
    expect(verificationText({ overallStatus: 'fail' })).toBe('Verification failed');
    expect(verificationText({ overallStatus: 'idle' })).toBe('Not verified yet');
  });
});
