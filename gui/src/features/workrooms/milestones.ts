export type MilestoneStatus = 'proposed' | 'in_progress' | 'completed' | 'failed' | 'rejected';

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

export function evaluateMilestoneStatus(entry: MilestoneEntry): MilestoneStatus {
  const combinedText = `${entry.message ?? ''} ${entry.content ?? ''}`;
  const evidenceText = entry.evidence ?? '';
  const hasNegative = isNegativeEvidence(combinedText) || isNegativeEvidence(evidenceText);

  // 1. Explicit status checking:
  if (entry.status === 'completed' || entry.status === 'verified') {
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

  // 2. Negative evidence fallback:
  if (hasNegative) {
    return 'failed';
  }

  // 3. Workroom proposal/confirmation contract:
  // Unconfirmed work defaults to 'proposed' (review requested)
  return 'proposed';
}
