import type { AISession, NormalizedRemainingQuota } from '../../types.js';
import type { TerminalInfo } from './client.js';

const count = (value: number) => value.toLocaleString();

/** Match a fresh terminal only when one provider session unambiguously belongs to it. */
export function findTerminalUsageSession(terminal: TerminalInfo, sessions: AISession[], otherTerminals: TerminalInfo[] = []): AISession | undefined {
  if (terminal.sessionId) {
    return sessions.find(session => session.id === terminal.sessionId && session.assistant === terminal.target);
  }
  if (!terminal.startedAt) return undefined;
  const started = Date.parse(terminal.startedAt);
  if (!Number.isFinite(started)) return undefined;
  const normalize = (value: string) => {
    const normalized = value.replaceAll('\\', '/').replace(/\/$/, '');
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const cwd = normalize(terminal.cwd);
  const reserved = new Set(otherTerminals.filter(other => other.id !== terminal.id && other.sessionId).map(other => other.sessionId));
  const competingStarts = otherTerminals
    .filter(other => other.id !== terminal.id && !other.sessionId && other.target === terminal.target && normalize(other.cwd) === cwd)
    .map(other => Date.parse(other.startedAt ?? ''))
    .filter(Number.isFinite);
  const candidates = sessions.filter(session => {
    const created = Date.parse(session.createdAt);
    return session.assistant === terminal.target
      && session.threadKind !== 'subagent'
      && !!session.recordedCwd && normalize(session.recordedCwd) === cwd
      && Number.isFinite(created) && created >= started - 5_000
      && !competingStarts.some(otherStarted => created >= otherStarted - 5_000)
      && !reserved.has(session.id);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

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
