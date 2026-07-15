import { AlertTriangle, Check, Cpu, RefreshCw } from 'lucide-react';

import { Alert } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../components/ui/select.js';
import { Separator } from '../components/ui/separator.js';
import { Spinner } from '../components/ui/spinner.js';
import { Switch } from '../components/ui/switch.js';
import type { DetectedEditor, NexusFlowConfig, StorageAdapterMeta } from '../types.js';

type LocalLlmProvider = NonNullable<NexusFlowConfig['localLlm']>['provider'];

interface ToolStatus {
  id: string;
  name: string;
  installed: boolean;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updateCmd: string;
}

interface SettingsPageProps {
  config: NexusFlowConfig | null;
  setConfig: (config: NexusFlowConfig) => void;
  saveStatus: 'success' | 'error' | null;
  editors: DetectedEditor[];
  adapters: StorageAdapterMeta[];
  saveAppConfig: (config: NexusFlowConfig) => void;
  isSettingsFormValid: boolean;
  recommendation?: any;
  testingLlm: boolean;
  testStatus: { success: boolean; message: string } | null;
  testLlmConnection: () => void;
  toolsStatus: ToolStatus[];
  toolsLoading: boolean;
  updatingToolId: string | null;
  fetchToolsStatus: (force?: boolean) => void;
  handleUpdateTool: (toolId: string) => void;
}

export function SettingsPage({
  config,
  setConfig,
  saveStatus,
  editors,
  adapters,
  saveAppConfig,
  isSettingsFormValid,
  recommendation,
  testingLlm,
  testStatus,
  testLlmConnection,
  toolsStatus,
  toolsLoading,
  updatingToolId,
  fetchToolsStatus,
  handleUpdateTool,
}: SettingsPageProps) {
  if (!config) return null;

  const selectedEditor = editors.find((ed) => ed.command === config.defaultEditor);
  const selectedAdapter = adapters.find((a) => a.name === (config.storageProvider || 'local'));
  const endpointInvalid = Boolean(
    config.localLlm?.endpoint &&
      !config.localLlm.endpoint.trim().startsWith('http://') &&
      !config.localLlm.endpoint.trim().startsWith('https://'),
  );

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Global Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your local directories, search parameters, and editor defaults.
        </p>
      </header>

      {saveStatus === 'success' && (
        <Alert variant="success" className="mb-6">
          <Check size={18} /> Settings successfully saved and updated!
        </Alert>
      )}
      {saveStatus === 'error' && (
        <Alert variant="error" className="mb-6">
          <AlertTriangle size={18} /> Error: Could not save configuration details to disk.
        </Alert>
      )}

      <Card className="mb-6 rounded-xl p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Development Directory</Label>
            <Input
              type="text"
              value={config.devDir}
              onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">Directory where your git projects are scanned.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Workspaces Directory</Label>
            <Input
              type="text"
              value={config.workspacesDir}
              onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">Directory where unified worktree environments are spun up.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Repo Search Depth</Label>
            <Input
              type="number"
              min={1}
              max={5}
              value={config.scanDepth}
              onChange={(e) => setConfig({ ...config, scanDepth: parseInt(e.target.value, 10) })}
            />
            <span className="text-xs text-muted-foreground">
              Max directory levels deep the system will traverse for git repos.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Default Assistant</Label>
            <Select
              value={config.defaultAssistant || ''}
              onValueChange={(value) =>
                typeof value === 'string' && setConfig({ ...config, defaultAssistant: value || null })
              }
            >
              <SelectTrigger aria-label="Default Assistant">
                <SelectValue>
                  {config.defaultAssistant === 'claude'
                    ? 'Claude Code'
                    : config.defaultAssistant === 'antigravity'
                      ? 'Antigravity'
                      : config.defaultAssistant === 'codex'
                        ? 'Codex'
                        : config.defaultAssistant === 'copilot'
                          ? 'GitHub Copilot'
                          : config.defaultAssistant === 'cursor'
                            ? 'Cursor'
                            : 'None (Prompt me)'}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                <SelectItem value="">None (Prompt me)</SelectItem>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="antigravity">Antigravity</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="copilot">GitHub Copilot</SelectItem>
                <SelectItem value="cursor">Cursor</SelectItem>
              </SelectPopup>
            </Select>
            <span className="text-xs text-muted-foreground">Your preferred workspace context manager.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Default Editor</Label>
            <Select
              value={config.defaultEditor || ''}
              onValueChange={(value) =>
                typeof value === 'string' && setConfig({ ...config, defaultEditor: value || null })
              }
            >
              <SelectTrigger aria-label="Default Editor">
                <SelectValue>
                  {selectedEditor
                    ? `${selectedEditor.name} ${selectedEditor.detected ? '(Detected)' : '(Not found)'}`
                    : 'None (Skip opening)'}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                <SelectItem value="">None (Skip opening)</SelectItem>
                {editors.map((ed) => (
                  <SelectItem key={ed.command} value={ed.command}>
                    {ed.name} {ed.detected ? '(Detected)' : '(Not found)'}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="text-xs text-muted-foreground">Your preferred code editor for opening workspaces.</span>
          </div>

          <div className="flex flex-col gap-4 md:col-span-2">
            <Separator className="mt-1" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Workspace Storage Settings</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose where maps, plans, and knowledge files are stored.
              </p>
            </div>

            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="storageProvider" className="text-sm">
                Storage Provider
              </Label>
              <Select
                value={config.storageProvider || 'local'}
                onValueChange={(value) => {
                  if (typeof value !== 'string') return;
                  const val = value;
                  const newConf = { ...config, storageProvider: val };
                  const adapterForValue = adapters.find((a) => a.name === val);
                  if (adapterForValue?.configFields?.length) {
                    if (!newConf.adapterConfig) newConf.adapterConfig = {};
                    if (!newConf.adapterConfig[val]) newConf.adapterConfig[val] = {};
                    adapterForValue.configFields.forEach((f) => {
                      if (newConf.adapterConfig![val][f.key] === undefined && f.default !== undefined) {
                        newConf.adapterConfig![val][f.key] = f.default;
                      }
                    });
                  }
                  setConfig(newConf);
                }}
              >
                <SelectTrigger id="storageProvider" aria-label="Storage Provider">
                  <SelectValue>
                    {selectedAdapter?.displayName ??
                      (config.storageProvider === 'central-vault' ? 'Obsidian Central Vault' : 'Local Workspace (Folders)')}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {adapters.length > 0 ? (
                    adapters.map((a) => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.displayName}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="local">Local Workspace (Folders)</SelectItem>
                      <SelectItem value="central-vault">Obsidian Central Vault</SelectItem>
                    </>
                  )}
                </SelectPopup>
              </Select>
              <span className="text-xs text-muted-foreground">
                {selectedAdapter?.description ||
                  'Choose where to store maps, plans, and knowledge files. Centralized vault keeps repositories 100% clean and allows Obsidian integration.'}
              </span>
            </div>

            {(() => {
              const activeProv = config.storageProvider || 'local';
              const activeAdapter = adapters.find((a) => a.name === activeProv);
              if (!activeAdapter?.configFields?.length) {
                return null;
              }

              return (
                <div className="flex max-w-md flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {activeAdapter.displayName} Settings
                  </h4>
                  {activeAdapter.configFields.map((field) => {
                    const value = config.adapterConfig?.[activeProv]?.[field.key] ?? field.default ?? '';
                    const updateField = (val: any) => {
                      const newAdapterConfig = {
                        ...(config.adapterConfig || {}),
                        [activeProv]: {
                          ...(config.adapterConfig?.[activeProv] || {}),
                          [field.key]: val,
                        },
                      };
                      setConfig({ ...config, adapterConfig: newAdapterConfig });
                    };

                    if (field.type === 'boolean') {
                      return (
                        <Label key={field.key} className="flex cursor-pointer items-start gap-3 text-sm">
                          <Switch checked={!!value} onCheckedChange={(checked) => updateField(checked)} />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">{field.label}</span>
                            {field.description && (
                              <span className="mt-0.5 text-xs leading-normal text-muted-foreground">
                                {field.description}
                              </span>
                            )}
                          </span>
                        </Label>
                      );
                    }

                    return (
                      <div key={field.key} className="flex flex-col gap-1.5">
                        <Label className="text-sm">{field.label}</Label>
                        <Input
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={value}
                          onChange={(e) => {
                            const val = field.type === 'number' ? Number(e.target.value) : e.target.value;
                            updateField(val);
                          }}
                        />
                        {field.description && (
                          <span className="text-xs leading-normal text-muted-foreground">{field.description}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </Card>

      <Card className="mb-6 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground">Local AI Co-Processor Settings</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable a local LLM to handle simple tasks like log analysis, git diff summaries, and boilerplate code
          generation without using remote tokens.
        </p>

        {recommendation && (
          <div className="mt-6 flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Cpu size={14} /> Local System Scan Results
            </div>
            <div>
              Detected Memory: <strong className="text-foreground">{recommendation.totalRamGb} GB RAM</strong>
            </div>
            <div>
              Detected GPU: <strong className="text-foreground">{recommendation.gpuName}</strong>
            </div>
            <div>
              Recommended Model:{' '}
              <Badge variant="info" className="font-mono">
                {recommendation.recommendedModel}
              </Badge>
            </div>
          </div>
        )}

        <Label id="localLlmEnabled" className="mt-6 flex cursor-pointer items-center gap-3">
          <Switch
            checked={config.localLlm?.enabled || false}
            onCheckedChange={(checked) => {
              const defaultLlm = {
                enabled: checked,
                provider: 'ollama' as const,
                endpoint: 'http://localhost:11434',
                model: recommendation?.recommendedModel || 'qwen2.5-coder:1.5b',
              };
              setConfig({
                ...config,
                localLlm: config.localLlm ? { ...config.localLlm, enabled: checked } : defaultLlm,
              });
            }}
          />
          Enable Local AI Delegation Tool
        </Label>

        {config.localLlm?.enabled && (
          <div className="mt-6 space-y-6 border-t border-border pt-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Local Provider</Label>
                <Select
                  value={config.localLlm.provider}
                  onValueChange={(value) =>
                    typeof value === 'string' &&
                    setConfig({
                      ...config,
                      localLlm: { ...config.localLlm!, provider: value as LocalLlmProvider },
                    })
                  }
                >
                  <SelectTrigger aria-label="Local Provider">
                    <SelectValue>
                      {config.localLlm.provider === 'openai-compatible'
                        ? 'OpenAI-Compatible (e.g. LM Studio)'
                        : 'Ollama'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="openai-compatible">OpenAI-Compatible (e.g. LM Studio)</SelectItem>
                  </SelectPopup>
                </Select>
                <span className="text-xs text-muted-foreground">Provider protocol to connect to.</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Endpoint URL</label>
                <input
                  type="text"
                  className={`h-9 w-full rounded-lg border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground/72 focus-visible:ring-[3px] ${
                    endpointInvalid
                      ? 'border-destructive/64 focus-visible:border-destructive focus-visible:ring-destructive/16'
                      : 'border-input focus-visible:border-ring focus-visible:ring-ring/24'
                  }`}
                  value={config.localLlm.endpoint}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      localLlm: { ...config.localLlm!, endpoint: e.target.value },
                    })
                  }
                />
                {endpointInvalid && (
                  <span className="text-xs text-destructive-foreground">
                    Endpoint must start with http:// or https://
                  </span>
                )}
                <span className="text-xs text-muted-foreground">API base address of the local runner.</span>
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-sm">Model Name</Label>
                <Input
                  type="text"
                  value={config.localLlm.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      localLlm: { ...config.localLlm!, model: e.target.value },
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Exact name of the model registered on the server (e.g.,{' '}
                  <code className="font-mono text-foreground">qwen2.5-coder:1.5b</code>).
                </span>
              </div>

              {config.localLlm.provider === 'openai-compatible' && (
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label className="text-sm">API Key (Optional)</Label>
                  <Input
                    type="password"
                    value={config.localLlm.apiKey || ''}
                    placeholder="sk-..."
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        localLlm: { ...config.localLlm!, apiKey: e.target.value },
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional key for authenticating with cloud LLM providers (e.g. OpenAI, DeepSeek, OpenRouter).
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="outline" size="sm" disabled={testingLlm} onClick={testLlmConnection}>
                {testingLlm && <Spinner className="size-3" />}
                {testingLlm ? 'Testing...' : 'Test Connection'}
              </Button>

              {testStatus && (
                <div
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    testStatus.success
                      ? 'border-success/32 bg-success/8 text-success-foreground'
                      : 'border-destructive/32 bg-destructive/8 text-destructive-foreground'
                  }`}
                >
                  {testStatus.message}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="mt-6 rounded-xl p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">AI Toolchain Updates</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor and update the CLI packages and assistants in your workflow.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchToolsStatus(true)} disabled={toolsLoading}>
            {toolsLoading ? <Spinner className="size-3" /> : <RefreshCw size={13} />}
            {toolsLoading ? 'Checking...' : 'Check Now'}
          </Button>
        </div>

        {toolsLoading && toolsStatus.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <Spinner className="size-6" />
            <span className="text-xs">Fetching registry version details...</span>
          </div>
        ) : toolsStatus.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">No toolchain information available.</p>
        ) : (
          <div className="space-y-4">
            {toolsStatus.map((tool) => (
              <div
                key={tool.id}
                className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {tool.name}
                    <Badge variant={tool.installed ? 'success' : 'secondary'} size="sm">
                      {tool.installed ? 'Installed' : 'Not Installed'}
                    </Badge>
                  </h4>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Installed version: <code className="font-mono text-[10px] text-foreground">{tool.currentVersion}</code>
                    </span>
                    {tool.installed && (
                      <span>
                        Latest: <code className="font-mono text-[10px] text-foreground">{tool.latestVersion}</code>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{tool.updateCmd}</p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {tool.updateAvailable ? (
                    <Button size="sm" onClick={() => handleUpdateTool(tool.id)} disabled={updatingToolId !== null}>
                      {updatingToolId === tool.id ? (
                        <>
                          <Spinner className="size-3" /> Updating...
                        </>
                      ) : (
                        'Update Tool'
                      )}
                    </Button>
                  ) : tool.installed ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success" className="gap-1.5">
                        <Check size={12} /> Up to Date
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdateTool(tool.id)}
                        disabled={updatingToolId !== null}
                      >
                        {updatingToolId === tool.id ? (
                          <>
                            <Spinner className="size-3" /> Reinstalling...
                          </>
                        ) : (
                          'Reinstall'
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpdateTool(tool.id)}
                      disabled={updatingToolId !== null}
                    >
                      {updatingToolId === tool.id ? (
                        <>
                          <Spinner className="size-3" /> Installing...
                        </>
                      ) : (
                        'Install CLI'
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-10 flex justify-end pt-4">
        <Button onClick={() => saveAppConfig(config)} disabled={!isSettingsFormValid}>
          <Check size={16} /> Save Configuration
        </Button>
      </div>
    </div>
  );
}
