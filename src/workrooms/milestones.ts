/**
 * Milestone status evaluation and verification contracts.
 * Preserves the Workroom proposal/confirmation distinction and prevents
 * unverified work or failure evidence from displaying as verified.
 */

export type MilestoneStatus = 'proposed' | 'in_progress' | 'completed' | 'failed' | 'rejected';

/**
 * Checks if a string contains explicit failure, error, or unverified indicators.
 */
export function isNegativeEvidence(text?: string): boolean {
  if (!text) return false;
  return /\b(fail|failed|failing|error|errors|unverified|not verified|rejected|timeout|timed out)\b/i.test(text);
}

export interface MilestoneEntry {
  status?: string;
  stepProposal?: unknown;
  message?: string;
  content?: string;
  evidence?: string;
}

/**
 * Evaluates the milestone status according to explicit validated states,
 * negative evidence checks, and the proposal vs confirmation contract.
 */
export function evaluateMilestoneStatus(entry: MilestoneEntry): MilestoneStatus {
  const combinedText = `${entry.message ?? ''} ${entry.content ?? ''}`;
  const evidenceText = entry.evidence ?? '';
  const hasNegative = isNegativeEvidence(combinedText) || isNegativeEvidence(evidenceText);

  // 1. Explicit status checking:
  if (entry.status === 'completed' || entry.status === 'verified') {
    // If evidence or message explicitly documents failure, it cannot be completed
    return hasNegative ? 'failed' : 'completed';
  }
  if (entry.status === 'failed' || entry.status === 'rejected') {
    return 'failed';
  }
  if (entry.status === 'in_progress') {
    return 'in_progress';
  }
  if (entry.status === 'proposed' || entry.status === 'completion_proposed') {
    return hasNegative ? 'failed' : 'proposed';
  }

  // 2. Negative evidence or negative text without explicit status:
  if (hasNegative) {
    return 'failed';
  }

  // 3. Workroom proposal/confirmation contract:
  // Unconfirmed proposals or default step updates remain 'proposed' (review requested),
  // requiring human verification/confirmation to reach terminal 'completed'.
  return 'proposed';
}
