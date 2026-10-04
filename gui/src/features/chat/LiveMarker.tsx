import { HarnessIcon } from '../../components/icons/HarnessIcon.js';
import { cn } from '../../lib/utils.js';
import { liveText, type LiveSessions, type LiveState } from './liveSessions.js';

/** The dot that says a CLI runs here: steady when idle, pulsing while it works, amber when it waits for you, hollow when no chat shows it. */
export function LiveDot({ state, title, className }: { state: LiveState; title?: string; className?: string }) {
  return <span aria-hidden="true" title={title} data-state={state} className={cn('live-dot', className)} />;
}

/** The tools running in a workspace and the dot. Hidden from screen readers: the row it sits in says the same in words. */
export function LiveMarker({ live, now, className }: { live: LiveSessions; now: number; className?: string }) {
  return (
    <span aria-hidden="true" title={liveText(live, now)} data-live={live.state} className={cn('inline-flex shrink-0 items-center gap-1 text-muted-foreground', className)}>
      {live.targets.slice(0, 2).map((target) => <HarnessIcon key={target} harness={target} className="size-3" />)}
      <LiveDot state={live.state} />
    </span>
  );
}
