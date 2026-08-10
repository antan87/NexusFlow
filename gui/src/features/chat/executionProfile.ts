export type ChatExecutionProfile = 'review' | 'workspace-write';

export function isChatExecutionProfile(value: unknown): value is ChatExecutionProfile {
  return value === 'review' || value === 'workspace-write';
}

