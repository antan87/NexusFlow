import { cn } from '../../lib/utils.js';
import { activityNotes, type SessionActivity } from './sessionActivity.js';

interface ActivityDotsProps {
  activity: SessionActivity | undefined;
  /** False where the surrounding element already names these in its own label, such as a rail tile. */
  announce?: boolean;
  className?: string;
}

/**
 * The small dots for what a workspace's terminal reports: stopped, disconnected, or printed something unseen. A terminal
 * that is running is the normal case and has no dot, so a dot always means look here.
 */
export function ActivityDots({ activity, announce = true, className }: ActivityDotsProps) {
  const notes = activityNotes(activity);
  if (notes.length === 0) return null;
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {activity?.status === 'disconnected' && <span aria-hidden="true" title="Terminal disconnected" className="size-1.5 rounded-full bg-amber-500" />}
      {activity?.status === 'exited' && <span aria-hidden="true" title="Terminal exited" className="size-1.5 rounded-full bg-muted-foreground" />}
      {activity?.unread && <span aria-hidden="true" title="New terminal output" className="size-1.5 rounded-full bg-primary" />}
      {announce && <span className="sr-only">{notes.join('. ')}</span>}
    </span>
  );
}
