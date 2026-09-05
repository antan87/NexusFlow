import { describe, it, expect } from 'vitest';
import { evaluateMilestoneStatus, isNegativeEvidence } from './milestones.js';

describe('milestones verification and status contract', () => {
  it('detects negative evidence indicators', () => {
    expect(isNegativeEvidence('npm test: FAIL')).toBe(true);
    expect(isNegativeEvidence('tests failed on step 2')).toBe(true);
    expect(isNegativeEvidence('Not verified; tests failed.')).toBe(true);
    expect(isNegativeEvidence('Unverified proposal.')).toBe(true);
    expect(isNegativeEvidence('request rejected by host')).toBe(true);
    expect(isNegativeEvidence('timed out waiting for response')).toBe(true);
    expect(isNegativeEvidence('78/78 files passed, 862/862 tests passing')).toBe(false);
    expect(isNegativeEvidence('')).toBe(false);
    expect(isNegativeEvidence(undefined)).toBe(false);
  });

  it('rejects "Not verified; tests failed." as failed, not verified', () => {
    const status = evaluateMilestoneStatus({
      message: 'Not verified; tests failed.',
      evidence: 'npm test: FAIL',
    });
    expect(status).toBe('failed');
    expect(status).not.toBe('completed');
  });

  it('rejects "Unverified proposal." as failed/unverified, not verified', () => {
    const status = evaluateMilestoneStatus({
      message: 'Unverified proposal.',
    });
    expect(status).toBe('failed');
    expect(status).not.toBe('completed');
  });

  it('rejects negative evidence "npm test: FAIL" even if status claims completed', () => {
    const status = evaluateMilestoneStatus({
      status: 'completed',
      message: 'All done.',
      evidence: 'npm test: FAIL',
    });
    expect(status).toBe('failed');
    expect(status).not.toBe('completed');
  });

  it('preserves unconfirmed proposal as proposed (review requested), not completed', () => {
    const status = evaluateMilestoneStatus({
      status: 'proposed',
      message: 'Implemented feature slice. Requesting review.',
      evidence: 'npm test: 862 passed',
    });
    expect(status).toBe('proposed');
    expect(status).not.toBe('completed');
  });

  it('marks explicitly completed step with valid evidence as completed', () => {
    const status = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Feature verified and approved by reviewer.',
      evidence: 'npm test: 862/862 passed',
    });
    expect(status).toBe('completed');
  });

  it('marks in_progress steps as in_progress', () => {
    const status = evaluateMilestoneStatus({
      status: 'in_progress',
      message: 'Working on API routes...',
    });
    expect(status).toBe('in_progress');
  });
});
