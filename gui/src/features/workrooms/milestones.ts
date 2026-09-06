/**
 * Milestone status evaluation and verification contracts.
 * Preserves the Workroom proposal/confirmation distinction and prevents
 * unverified work, agent self-confirmations, or failure evidence from displaying as verified.
 */

export type MilestoneStatus = 'proposed' | 'in_progress' | 'completed' | 'failed' | 'rejected';

export interface MilestoneStepProposal {
  stepId?: string;
  status?: string;
  evidence?: string;
  revision?: number;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface MilestoneEntry {
  stepId?: string;
  status?: string;
  author?: string;
  harness?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  stepProposal?: MilestoneStepProposal | null;
  syncError?: string | null;
  message?: string;
  content?: string;
  evidence?: string;
}

/**
 * Checks if a string contains explicit failure, error, or unverified indicators.
 */
export function isNegativeEvidence(text?: string): boolean {
  if (!text) return false;
  return /\b(fail|failed|failing|error|errors|unverified|not verified|rejected|timeout|timed out)\b/i.test(text);
}

/**
 * Checks if an entry was authored by a trusted human authority or explicitly confirmed by a human.
 */
export function isHumanAuthority(entry: MilestoneEntry): boolean {
  if (entry.confirmedBy && String(entry.confirmedBy).trim().length > 0) {
    return true;
  }
  const author = (entry.author ?? '').trim().toLowerCase();
  if (author === 'human' || author === 'user') {
    return true;
  }
  if (author === 'agent') {
    return false;
  }
  // Fallback to harness if author is not explicitly set
  const harness = (entry.harness ?? '').trim().toLowerCase();
  if (harness === 'human' || harness === 'developer' || harness === 'user') {
    return true;
  }
  return false;
}

/**
 * Evaluates the milestone status according to explicit validated states,
 * remote authoritative state, provenance/authority boundaries, negative evidence checks,
 * and the proposal vs confirmation contract.
 */
export function evaluateMilestoneStatus(entry: MilestoneEntry): MilestoneStatus {
  const combinedText = `${entry.message ?? ''} ${entry.content ?? ''}`;
  const evidenceText = entry.evidence ?? '';
  const hasNegative = isNegativeEvidence(combinedText) || isNegativeEvidence(evidenceText);

  // 1. Failures and Negative Evidence:
  // Any negative evidence, explicit failed/rejected self-status, failed remote proposal,
  // or remote syncError is treated as failed.
  if (
    hasNegative ||
    entry.status === 'failed' ||
    entry.status === 'rejected' ||
    entry.stepProposal?.status === 'failed' ||
    entry.stepProposal?.status === 'rejected' ||
    Boolean(entry.syncError)
  ) {
    return 'failed';
  }

  // 2. In-Progress:
  if (entry.status === 'in_progress' || entry.stepProposal?.status === 'in_progress') {
    return 'in_progress';
  }

  // 3. Evidence Requirement for Terminal Completion:
  // A milestone CANNOT be confirmed completed without non-empty verification evidence.
  const remoteEvidence = entry.stepProposal?.evidence && String(entry.stepProposal.evidence).trim().length > 0;
  const localEvidence = Boolean(evidenceText.trim());
  const hasEvidence = localEvidence || Boolean(remoteEvidence);
  if (!hasEvidence) {
    return 'proposed';
  }

  // 4. Remote Authoritative State check:
  // When remote step state is attached, remote authoritative state takes precedence over local claims.
  if (entry.stepProposal) {
    // If remote step is only a proposal (completion_proposed or pending),
    // local claims cannot bypass it to claim completed.
    if (entry.stepProposal.status === 'completion_proposed' || entry.stepProposal.status === 'pending') {
      return 'proposed';
    }
    // If remote step was confirmed completed via authenticated human transition in Workroom:
    if (entry.stepProposal.status === 'completed') {
      return 'completed';
    }
  }

  // 5. Local Provenance / Authority check:
  // Agent-originated reports are strictly capped at proposed/in-progress/failed.
  // Agents cannot self-confirm completion.
  const isHuman = isHumanAuthority(entry);
  if (!isHuman) {
    return 'proposed';
  }

  // 6. Trusted Human Confirmation:
  // Human author explicitly completed or confirmed the milestone, with valid evidence and no negative flags.
  if (entry.status === 'completed' || entry.status === 'verified' || Boolean(entry.confirmedBy)) {
    return 'completed';
  }

  return 'proposed';
}
