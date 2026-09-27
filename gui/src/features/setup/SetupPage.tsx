import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, ChevronRight, FolderGit2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Spinner } from '../../components/ui/spinner.js';
import { RepoChecklist } from '../../components/RepoChecklist.js';
import { useRepos } from '../../lib/api/queries.js';
import { BRAND_NAME } from '../../brand.js';
import type { ContextSpaceConfig, StorageAdapterMeta } from '../../types.js';
import { FolderField } from './FolderField.js';
import { checkFolders, folderErrors, folderExamples, repoSummary, saveConfig, type ConfigPathsReport, type FolderKey } from './setupApi.js';

interface SetupPageProps {
  initialConfig: ContextSpaceConfig;
  /** Folders suggested by the server for this computer. */
  suggested: { devDir: string; workspacesDir: string } | null;
  platform?: string;
  adapters: StorageAdapterMeta[];
  /** Called once the user leaves setup; the app then shows its normal shell. */
  onComplete: (config: ContextSpaceConfig) => void;
}

/**
 * First run. Asks for the two folders ContextSpace needs, checks them on the
 * server before saving, keeps every value on failure, and hands the found
 * repositories straight to Start work.
 */
export function SetupPage({ initialConfig, suggested, platform, adapters, onComplete }: SetupPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ContextSpaceConfig>(() => ({
    ...initialConfig,
    devDir: initialConfig.devDir || suggested?.devDir || '',
    workspacesDir: initialConfig.workspacesDir || suggested?.workspacesDir || '',
  }));
  const [report, setReport] = useState<ConfigPathsReport>({ ok: false });
  const [checking, setChecking] = useState<Partial<Record<FolderKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<ContextSpaceConfig | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const checkRequest = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const examples = folderExamples(platform);

  const runCheck = async (next: ContextSpaceConfig, fields: FolderKey[]) => {
    const request = ++checkRequest.current;
    setChecking(Object.fromEntries(fields.map((field) => [field, true])));
    try {
      const result = await checkFolders({ devDir: next.devDir, workspacesDir: next.workspacesDir });
      if (request === checkRequest.current) setReport(result);
    } catch {
      // A failed check is not a verdict on the folder; saving checks again.
    } finally {
      if (request === checkRequest.current) setChecking({});
    }
  };

  // Check suggested folders up front so the user sees whether they work.
  useEffect(() => {
    if (config.devDir || config.workspacesDir) void runCheck(config, ['devDir', 'workspacesDir']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (field: FolderKey, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    // An edited value has not been checked yet.
    setReport((current) => ({ ...current, ok: false, [field]: undefined }));
  };
  const commit = (field: FolderKey, value: string) => {
    const next = { ...config, [field]: value };
    if (value.trim()) void runCheck(next, [field]);
  };

  const workspacesMissing = report.workspacesDir?.status === 'missing' && report.workspacesDir.canCreate;
  const canSubmit = !saving && config.devDir.trim() !== '' && config.workspacesDir.trim() !== '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveConfig(config, { createWorkspacesDir: workspacesMissing });
      const stored = { ...config, ...result.config };
      setConfig(stored);
      setSaved(stored);
      await queryClient.invalidateQueries({ queryKey: ['repos'] });
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    } catch (error) {
      const fields = folderErrors(error);
      if (fields) {
        setReport(fields);
        setSaveError('Some folders need attention. Your entries are unchanged.');
      } else {
        setSaveError(`${error instanceof Error ? error.message : 'The settings could not be saved.'} Your entries are unchanged — try again.`);
      }
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return <SetupDone
      config={saved}
      selected={selectedRepos}
      onSelect={setSelectedRepos}
      onChangeFolder={() => setSaved(null)}
      onFinish={(target) => {
        onComplete(saved);
        navigate(target);
      }}
    />;
  }

  const activeAdapter = adapters.find((adapter) => adapter.name === (config.storageProvider || 'local'));

  return (
    <main className="flex min-h-screen items-start justify-center bg-background p-4 font-sans text-foreground sm:items-center sm:p-6">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Set up {BRAND_NAME}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {BRAND_NAME} needs to know where your code lives and where it may create workspaces. You can change both later in Settings.
        </p>

        <form className="mt-6 flex flex-col gap-5" noValidate onSubmit={submit} aria-busy={saving}>
          <FolderField
            id="setup-devDir"
            label="Code folder"
            description="The folder that holds your Git repositories. They stay read-only references until you prepare one for editing."
            placeholder={`e.g. ${examples.devDir}`}
            value={config.devDir}
            disabled={saving}
            onChange={(value) => update('devDir', value)}
            onCommit={(value) => commit('devDir', value)}
            check={report.devDir}
            checking={checking.devDir}
            okText={repoSummary(report.devDir?.repoCount)}
          />
          <FolderField
            id="setup-workspacesDir"
            label="Workspaces folder"
            description={`Where ${BRAND_NAME} creates a folder per task, with isolated checkouts and assistant context.`}
            placeholder={`e.g. ${examples.workspacesDir}`}
            value={config.workspacesDir}
            disabled={saving}
            onChange={(value) => update('workspacesDir', value)}
            onCommit={(value) => commit('workspacesDir', value)}
            check={report.workspacesDir}
            checking={checking.workspacesDir}
            okText="Ready for new workspaces."
            missingText={workspacesMissing ? 'This folder will be created when you continue.' : undefined}
          />
          {suggested && (config.devDir !== suggested.devDir || config.workspacesDir !== suggested.workspacesDir) && (
            <Button type="button" variant="link" className="self-start px-0" disabled={saving} onClick={() => {
              const next = { ...config, devDir: suggested.devDir, workspacesDir: suggested.workspacesDir };
              setConfig(next);
              void runCheck(next, ['devDir', 'workspacesDir']);
            }}>
              Use the suggested folders
            </Button>
          )}

          <details className="group rounded-lg border border-border px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden="true" size={14} className="transition-transform group-open:rotate-90" />
              Advanced
            </summary>
            <div className="mt-3 flex flex-col gap-1.5">
              <label htmlFor="setup-storageProvider" className="text-sm font-medium">Where generated context is stored</label>
              <Select
                value={config.storageProvider || 'local'}
                onValueChange={(value) => {
                  if (!value) return;
                  const next: ContextSpaceConfig = { ...config, storageProvider: value };
                  const adapter = adapters.find((candidate) => candidate.name === value);
                  if (adapter?.configFields?.length) {
                    next.adapterConfig = { ...next.adapterConfig, [value]: { ...next.adapterConfig?.[value] } };
                    for (const field of adapter.configFields) {
                      if (next.adapterConfig[value][field.key] === undefined && field.default !== undefined) next.adapterConfig[value][field.key] = field.default;
                    }
                  }
                  setConfig(next);
                }}
              >
                <SelectTrigger id="setup-storageProvider" aria-describedby="setup-storageProvider-help"><SelectValue /></SelectTrigger>
                <SelectPopup>
                  {(adapters.length ? adapters : [{ name: 'local', displayName: 'Local workspace folders' } as StorageAdapterMeta]).map((adapter) => (
                    <SelectItem key={adapter.name} value={adapter.name}>{adapter.displayName}</SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <p id="setup-storageProvider-help" className="text-xs text-muted-foreground">
                {activeAdapter?.description || 'The default keeps everything in the workspace folder, where assistants read it. Most people never change this.'}
              </p>
            </div>
          </details>

          {saveError && (
            <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive outline-none">
              <AlertCircle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            {saving ? <><Spinner aria-hidden="true" role="presentation" className="size-4" />Saving…</> : <>Save and continue <ArrowRight aria-hidden="true" size={16} /></>}
          </Button>
          <p role="status" className="sr-only">{saving ? 'Saving your folders…' : ''}</p>
        </form>
      </div>
    </main>
  );
}

function SetupDone({ config, selected, onSelect, onChangeFolder, onFinish }: {
  config: ContextSpaceConfig;
  selected: string[];
  onSelect: (paths: string[]) => void;
  onChangeFolder: () => void;
  onFinish: (target: string) => void;
}) {
  const repos = useRepos();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const found = repos.data ?? [];
  const startTarget = selected.length ? `/new?${selected.map((path) => `repo=${encodeURIComponent(path)}`).join('&')}` : '/new';

  return (
    <main className="flex min-h-screen items-start justify-center bg-background p-4 font-sans text-foreground sm:items-center sm:p-6">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">You're set up</h1>
        {repos.isLoading ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" role="presentation" className="size-4" />Looking for repositories in {config.devDir}…</p>
        ) : repos.isError ? (
          <div role="alert" className="mt-4 text-sm text-destructive">
            The repositories in {config.devDir} could not be listed. <Button variant="link" className="h-auto px-0" onClick={() => void repos.refetch()}>Try again</Button>
          </div>
        ) : found.length === 0 ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>No Git repositories were found in <code className="break-all">{config.devDir}</code>.</p>
            <p className="text-muted-foreground">Choose the folder that contains your repositories, or continue and add or create one when you start your first task.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onChangeFolder}>Choose another code folder</Button>
              <Button onClick={() => onFinish('/new')}>Continue <ArrowRight aria-hidden="true" size={16} /></Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Pick the repositories for your first task. You can change this on the next page.
            </p>
            <RepoChecklist
              repos={found}
              selectedPaths={selected}
              onToggle={(repo) => onSelect(selected.includes(repo.path) ? selected.filter((path) => path !== repo.path) : [...selected, repo.path])}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => onFinish('/overview')}>Skip for now</Button>
              <Button onClick={() => onFinish(startTarget)}>
                <FolderGit2 aria-hidden="true" size={16} />Start your first task
                {selected.length > 0 && <span className="text-xs opacity-80">({selected.length})</span>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
