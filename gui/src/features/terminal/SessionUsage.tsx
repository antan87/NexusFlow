import type { AISession, NormalizedRemainingQuota } from '../../types.js';

const count = (value: number) => value.toLocaleString();

export function quotaDetail(quota?: NormalizedRemainingQuota): string {
  if (!quota) return 'Remaining quota unavailable';
  const estimate = quota.isEstimated ? ' (estimate)' : '';
  if (quota.tokens?.remaining !== undefined) return `${count(quota.tokens.remaining)} tokens remaining${estimate}`;
  if (quota.requests?.remaining !== undefined) return `${count(quota.requests.remaining)} requests remaining${estimate}`;
  if (quota.creditsRemainingUsd !== undefined) return `$${quota.creditsRemainingUsd.toFixed(2)} credits remaining${estimate}`;
  if (quota.tokens?.status === 'exceeded' || quota.requests?.status === 'exceeded') return `Provider limit reached${estimate}`;
  if (quota.tokens?.status === 'approaching_limit' || quota.requests?.status === 'approaching_limit') return `Provider limit near${estimate}`;
  if (quota.planType === 'plan-included') return 'Included plan · remaining quota unavailable';
  return 'Remaining quota unavailable';
}

export function SessionUsageDetails({ session }: { session: AISession }) {
  const usage = session.usage;
  const hasTokens = usage && (usage.inputTokens > 0 || usage.outputTokens > 0 || (usage.cachedInputTokens ?? 0) > 0);
  const context = session.quota?.contextWindow;
  const quota = quotaDetail(session.quota);
  return <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Saved conversation usage">
    {hasTokens ? <span>Input {count(usage.inputTokens)} · Output {count(usage.outputTokens)}{usage.cachedInputTokens ? ` · Cached input ${count(usage.cachedInputTokens)}` : ''} tokens</span> : <span>Token usage unavailable</span>}
    <span>{quota === 'Remaining quota unavailable' ? quota : `Last reported quota: ${quota}`}</span>
    {context && <span>Context window {context.utilizationPercent !== undefined ? `${context.utilizationPercent.toFixed(1)}% used` : `${count(context.usedTokens)} of ${count(context.maxTokens)} tokens used`}</span>}
  </div>;
}
