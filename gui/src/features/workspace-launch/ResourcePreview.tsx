import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { apiFetch } from '../../lib/api/client.js';
import { Spinner } from '../../components/ui/spinner.js';

interface ResourcePreviewItem {
  kind: 'skill' | 'agent';
  id: string;
  title: string;
  description: string;
  files: string[];
}

/**
 * Before creating a workspace, shows every file the chosen skills and agents
 * will add and where, described by what each one does — so a first task needs
 * no knowledge of how resources are organised.
 */
export function ResourcePreview({ skills, agents, assistants, tagCount }: { skills: string[]; agents: string[]; assistants: string[]; tagCount: number }) {
  const selection = { skills: [...skills].sort(), agents: [...agents].sort(), assistants: [...assistants].sort() };
  const preview = useQuery({
    queryKey: ['resource-preview', selection],
    queryFn: async ({ signal }) => (await apiFetch<{ resources: ResourcePreviewItem[] }>('/api/resources/preview', {
      signal,
      method: 'POST',
      body: JSON.stringify(selection),
    })).resources,
    enabled: skills.length + agents.length > 0,
  });

  if (skills.length + agents.length === 0 && tagCount === 0) {
    return <p className="text-xs text-muted-foreground">No skills or agents selected: the workspace gets only its generated assistant context.</p>;
  }

  return (
    <section aria-labelledby="resource-preview-heading" className="rounded-lg border border-border p-3">
      <h3 id="resource-preview-heading" className="text-sm font-medium">What this adds to the workspace</h3>
      {tagCount > 0 && <p className="mt-1 text-xs text-muted-foreground">Category tags can add more skills when the workspace is created.</p>}
      {preview.isLoading && <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner aria-hidden="true" role="presentation" className="size-3" />Working out the files…</p>}
      {preview.isError && <p role="alert" className="mt-2 text-xs text-destructive">{preview.error instanceof Error ? preview.error.message : 'The preview is unavailable.'} Creating the workspace still checks every selection.</p>}
      {preview.data && (
        <ul className="mt-2 space-y-2">
          {preview.data.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="text-xs">
              <p><span className="font-medium text-foreground">{item.title}</span> <span className="text-muted-foreground">— {item.kind === 'skill' ? 'skill' : 'Codex agent'}{item.description ? `: ${item.description}` : ''}</span></p>
              {item.files.length ? (
                <ul className="mt-1 space-y-0.5 pl-4">
                  {item.files.map((file) => <li key={file} className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground"><FileText aria-hidden="true" size={11} />{file}</li>)}
                </ul>
              ) : <p className="mt-1 pl-4 text-muted-foreground">No files for the selected assistants.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
