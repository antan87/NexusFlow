import { describe, it, expect } from 'vitest';
import { evaluateMilestoneStatus, isNegativeEvidence, isHumanAuthority } from './milestones.js';

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
      author: 'human',
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
      author: 'human',
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

  it('marks in_progress steps as in_progress', () => {
    const status = evaluateMilestoneStatus({
      status: 'in_progress',
      message: 'Working on API routes...',
    });
    expect(status).toBe('in_progress');
  });

  // ---------------------------------------------------------------------------
  // REGRESSION TESTS REQUESTED BY REVIEWER:
  // 1. agent-completed
  // 2. absent-evidence
  // 3. failed-remote-proposal
  // 4. human-confirmed
  // ---------------------------------------------------------------------------

  it('regression: caps agent-completed claims at proposed (review requested)', () => {
    // Concrete case from reviewer:
    // {message: "Done", stepId: "step-verify", status: "completed", evidence: "npm test passed", harness: "codex"}
    const statusCodex = evaluateMilestoneStatus({
      message: 'Done',
      stepId: 'step-verify',
      status: 'completed',
      evidence: 'npm test passed',
      harness: 'codex',
    });
    expect(statusCodex).toBe('proposed');
    expect(statusCodex).not.toBe('completed');

    const statusAgy = evaluateMilestoneStatus({
      message: 'Done',
      stepId: 'step-verify',
      status: 'completed',
      evidence: 'npm test passed',
      author: 'agent',
      harness: 'antigravity',
    });
    expect(statusAgy).toBe('proposed');
  });

  it('regression: returns proposed when evidence is absent or whitespace only', () => {
    // Absent evidence
    const statusNoEvidence = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Feature finished without evidence',
      author: 'human',
    });
    expect(statusNoEvidence).toBe('proposed');
    expect(statusNoEvidence).not.toBe('completed');

    // Empty / whitespace evidence
    const statusWhitespaceEvidence = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Feature finished with blank evidence',
      evidence: '    ',
      confirmedBy: 'human-user',
    });
    expect(statusWhitespaceEvidence).toBe('proposed');
  });

  it('regression: returns failed when remote step proposal fails or has syncError', () => {
    // Failed remote proposal
    const statusFailedProposal = evaluateMilestoneStatus({
      message: 'Proposing completion',
      stepId: 'step-verify',
      status: 'proposed',
      stepProposal: { status: 'failed' },
      harness: 'codex',
    });
    expect(statusFailedProposal).toBe('failed');

    // syncError from remote Workroom
    const statusSyncError = evaluateMilestoneStatus({
      message: 'Proposing completion',
      stepId: 'step-verify',
      status: 'proposed',
      syncError: 'Workflow step "step-verify" was not found in the shared room workflow.',
      harness: 'codex',
    });
    expect(statusSyncError).toBe('failed');
  });

  it('regression: returns proposed when agent completed claims pending remote proposal', () => {
    const statusPendingProposal = evaluateMilestoneStatus({
      message: 'Done',
      stepId: 'step-verify',
      status: 'completed',
      evidence: 'npm test passed',
      stepProposal: { status: 'completion_proposed', revision: 1 },
      harness: 'codex',
    });
    expect(statusPendingProposal).toBe('proposed');
    expect(statusPendingProposal).not.toBe('completed');
  });

  it('regression: confirms completion for trusted human confirmation with valid evidence', () => {
    // Human author with clean evidence
    const statusHuman = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Feature verified and approved by reviewer.',
      evidence: 'npm test: 871 passed',
      author: 'human',
    });
    expect(statusHuman).toBe('completed');

    // Human developer harness
    const statusDevHarness = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Feature verified.',
      evidence: 'All integration checks passed.',
      harness: 'developer',
    });
    expect(statusDevHarness).toBe('completed');

    // Explicit confirmedBy
    const statusConfirmedBy = evaluateMilestoneStatus({
      status: 'completed',
      message: 'Verified by peer review.',
      evidence: 'Manual testing verified on localhost:4200',
      confirmedBy: 'maintainer@example.com',
    });
    expect(statusConfirmedBy).toBe('completed');
  });

  it('regression: recognizes remote authoritative completed state with evidence', () => {
    const statusRemoteConfirmed = evaluateMilestoneStatus({
      message: 'Step verified',
      stepId: 'step-verify',
      status: 'proposed',
      evidence: 'All tests passed',
      stepProposal: { status: 'completed', evidence: 'All tests passed', revision: 2 },
      harness: 'codex',
    });
    expect(statusRemoteConfirmed).toBe('completed');
  });

  it('identifies human authority correctly', () => {
    expect(isHumanAuthority({ author: 'human' })).toBe(true);
    expect(isHumanAuthority({ author: 'user' })).toBe(true);
    expect(isHumanAuthority({ harness: 'developer' })).toBe(true);
    expect(isHumanAuthority({ confirmedBy: 'alice' })).toBe(true);
    expect(isHumanAuthority({ author: 'agent', harness: 'developer' })).toBe(false);
    expect(isHumanAuthority({ harness: 'codex' })).toBe(false);
    expect(isHumanAuthority({ harness: 'antigravity' })).toBe(false);
    expect(isHumanAuthority({})).toBe(false);
  });
});
