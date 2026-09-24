import { Play } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { useServiceAction, useWorkspaceServices } from '../../lib/api/queries.js';

export function WorkspaceServicesControl({ workspace, active }: { workspace: string; active: boolean }) {
  const services = useWorkspaceServices(active ? workspace : null);
  const action = useServiceAction(workspace);
  if (!services.data?.services.length) return null;
  const running = services.data.runningState.length;
  return <span className="inline-flex items-center gap-1">
    {running ? <span className="text-[10px] text-emerald-600" title={`${running} running service${running === 1 ? '' : 's'}`}>{running} running</span>
      : <Button size="xs" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ action: 'start' })}><Play className="size-3" />Start services</Button>}
    {action.isError && <span role="alert" className="max-w-32 truncate text-[10px] text-destructive" title={action.error.message}>Could not start services</span>}
  </span>;
}
