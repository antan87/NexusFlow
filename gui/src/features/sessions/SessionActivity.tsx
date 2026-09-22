import type { AISession } from '../../types.js';

function date(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
function format(value: Date) {
  return value.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Activity may include tools and provider events; it is not necessarily a message. */
export function SessionActivity({ session }: { session: AISession }) {
  const latest = date(session.updatedAt), started = date(session.createdAt);
  return <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
    <span title={latest ? `Latest recorded activity: ${latest.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). May include tool or provider events.` : 'This harness history has no valid activity timestamp.'}>
      {latest ? <>Last activity <time dateTime={latest.toISOString()}>{format(latest)}</time></> : 'Last activity unknown'}
    </span>
    {started && <span className="text-muted-foreground" title={`First recorded activity: ${started.toLocaleString()}`}>
      Started <time dateTime={started.toISOString()}>{format(started)}</time>
    </span>}
  </span>;
}
