import type { LifecycleStep } from '../../types.js';
import type { VerificationGateTelemetry } from '../cockpit/cockpitStore.js';

/** The milestone being worked on, or the first one not yet done. */
export function nextMilestone(steps: LifecycleStep[]): LifecycleStep | undefined {
  return steps.find((step) => step.status === 'in_progress')
    ?? steps.find((step) => step.status === 'pending' || step.status === 'blocked');
}

export function verificationText(gate: VerificationGateTelemetry) {
  if (gate.overallStatus === 'pass') return `Verified${gate.durationMs !== undefined ? ` (${(gate.durationMs / 1000).toFixed(1)}s)` : ''}`;
  if (gate.overallStatus === 'fail') return 'Verification failed';
  if (gate.overallStatus === 'running') return 'Verifying…';
  return 'Not verified yet';
}
