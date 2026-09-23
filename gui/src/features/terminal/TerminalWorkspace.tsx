import { useState, type ComponentProps } from 'react';
import { ListTree } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { WorkspaceCodePanel } from '../changes/WorkspaceCodePanel.js';
import { TerminalPane } from './TerminalPane.js';

export function TerminalWorkspace(props: ComponentProps<typeof TerminalPane>) {
  const [showCode, setShowCode] = useState(false);
  const [openReference, setOpenReference] = useState<{ path: string; line?: number; id: number } | null>(null);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="border-b border-border px-2 py-1">
      <Button size="xs" variant={showCode ? 'secondary' : 'ghost'} aria-pressed={showCode} onClick={() => setShowCode(value => !value)}><ListTree className="size-3" />{showCode ? 'Hide code' : 'Show code'}</Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-row">
      <div className="min-h-0 min-w-0 flex-1"><TerminalPane {...props} codeVisible={showCode} onOpenFileReference={reference => { setOpenReference(current => ({ ...reference, id: (current?.id ?? 0) + 1 })); setShowCode(true); }} /></div>
      {showCode && <div className="h-full w-[45%] min-h-0 min-w-0 border-l border-border"><WorkspaceCodePanel workspace={props.workspace} active={props.active} openReference={openReference} /></div>}
    </div>
  </div>;
}
