import { Check, AlertTriangle, Cpu, RefreshCw, Sparkles } from 'lucide-react';
import type { NexusFlowConfig, StorageAdapterMeta, DetectedEditor } from '../types.js';

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
  handleUpdateTool
}: SettingsPageProps) {
  if (!config) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Global Settings</h1>
        <p className="text-sm text-gray-400">Configure your local directories, search parameters, and editor defaults.</p>
      </header>

      {saveStatus === 'success' && (
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl p-4 mb-6 text-sm">
          <Check size={18} /> Settings successfully saved and updated!
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="flex items-center gap-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl p-4 mb-6 text-sm">
          <AlertTriangle size={18} /> Error: Could not save configuration details to disk.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mb-6">
        <div className="flex flex-col">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Development Directory</label>
          <input
            type="text"
            className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
            value={config.devDir}
            onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
          />
          <span className="text-[10px] text-gray-500 mt-1">Directory where your git projects are scanned.</span>
        </div>

        <div className="flex flex-col">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Workspaces Directory</label>
          <input
            type="text"
            className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
            value={config.workspacesDir}
            onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
          />
          <span className="text-[10px] text-gray-500 mt-1">Directory where unified worktree environments are spun up.</span>
        </div>

        <div className="flex flex-col">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Repo Search Depth</label>
          <input
            type="number"
            className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
            min={1}
            max={5}
            value={config.scanDepth}
            onChange={(e) => setConfig({ ...config, scanDepth: parseInt(e.target.value, 10) })}
          />
          <span className="text-[10px] text-gray-500 mt-1">Max directory levels deep the system will traverse for git repos.</span>
        </div>

        <div className="flex flex-col">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Default Assistant</label>
          <select
            className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
            value={config.defaultAssistant || ''}
            onChange={(e) => setConfig({ ...config, defaultAssistant: e.target.value || null })}
          >
            <option value="">None (Prompt me)</option>
            <option value="claude">Claude Code</option>
            <option value="antigravity">Antigravity</option>
            <option value="codex">Codex</option>
            <option value="copilot">GitHub Copilot</option>
            <option value="cursor">Cursor</option>
          </select>
          <span className="text-[10px] text-gray-500 mt-1">Your preferred workspace context manager.</span>
        </div>

        <div className="flex flex-col">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Default Editor</label>
          <select
            className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
            value={config.defaultEditor || ''}
            onChange={(e) => setConfig({ ...config, defaultEditor: e.target.value || null })}
          >
            <option value="">None (Skip opening)</option>
            {editors.map((ed) => (
              <option key={ed.command} value={ed.command}>
                {ed.name} {ed.detected ? '(Detected)' : '(Not found)'}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-gray-500 mt-1">Your preferred code editor for opening workspaces.</span>
        </div>

        <div className="flex flex-col md:col-span-2 border-t border-gray-800/60 pt-6 mt-2">
          <h3 className="text-sm font-bold text-white mb-2">Workspace Storage Settings</h3>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="storageProvider" className="text-xs font-semibold text-white select-none">
              Storage Provider
            </label>
            <select
              id="storageProvider"
              className="w-full max-w-md text-xs bg-surface border border-gray-800 rounded-lg p-2 text-white focus:outline-none focus:border-indigo-500"
              value={config.storageProvider || 'local'}
              onChange={(e) => {
                const val = e.target.value;
                const newConf = { ...config, storageProvider: val };
                const selectedAdapter = adapters.find(a => a.name === val);
                if (selectedAdapter?.configFields?.length) {
                  if (!newConf.adapterConfig) newConf.adapterConfig = {};
                  if (!newConf.adapterConfig[val]) newConf.adapterConfig[val] = {};
                  selectedAdapter.configFields.forEach(f => {
                    if (newConf.adapterConfig![val][f.key] === undefined && f.default !== undefined) {
                      newConf.adapterConfig![val][f.key] = f.default;
                    }
                  });
                }
                setConfig(newConf);
              }}
            >
              {adapters.length > 0 ? (
                adapters.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.displayName}
                  </option>
                ))
              ) : (
                <>
                  <option value="local">Local Workspace (Folders)</option>
                  <option value="central-vault">Obsidian Central Vault</option>
                </>
              )}
            </select>
          </div>
          <span className="text-[10px] text-gray-500 mt-1">
            {adapters.find(a => a.name === (config.storageProvider || 'local'))?.description || 
              'Choose where to store maps, plans, and knowledge files. Centralized vault keeps repositories 100% clean and allows Obsidian integration.'}
          </span>

          {/* Dynamic config fields */}
          {(() => {
            const activeProv = config.storageProvider || 'local';
            const selectedAdapter = adapters.find((a) => a.name === activeProv);
            if (!selectedAdapter || !selectedAdapter.configFields || selectedAdapter.configFields.length === 0) {
              return null;
            }
            return (
              <div className="mt-4 p-4 rounded-lg bg-gray-950/40 border border-gray-800/80 max-w-md flex flex-col gap-4">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  {selectedAdapter.displayName} Settings
                </h4>
                {selectedAdapter.configFields.map((field) => {
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
                      <label key={field.key} className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-800 bg-gray-950 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                          checked={!!value}
                          onChange={(e) => updateField(e.target.checked)}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-200">{field.label}</span>
                          {field.description && (
                            <span className="text-[10px] text-gray-500 leading-normal mt-0.5">{field.description}</span>
                          )}
                        </div>
                      </label>
                    );
                  }

                  return (
                    <div key={field.key} className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-300">{field.label}</label>
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        className="w-full text-xs bg-slate-950 border border-gray-800 rounded p-2 text-white focus:outline-none focus:border-indigo-500"
                        value={value}
                        onChange={(e) => {
                          const val = field.type === 'number' ? Number(e.target.value) : e.target.value;
                          updateField(val);
                        }}
                      />
                      {field.description && (
                        <span className="text-[10px] text-gray-500 leading-normal mt-0.5">{field.description}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Local AI Co-Processor Settings */}
      <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mb-6 mt-6">
        <h3 className="text-lg font-bold text-white mb-2">Local AI Co-Processor Settings</h3>
        <p className="text-xs text-gray-450 mb-6 font-semibold">Enable a local LLM to handle simple tasks like log analysis, git diff summaries, and boilerplate code generation without using remote tokens.</p>

        {recommendation && (
          <div className="bg-[#0c1020]/80 border border-indigo-500/20 text-xs text-gray-300 rounded-xl p-4 mb-6 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-indigo-400 font-bold">
              <Cpu size={14} /> Local System Scan Results
            </div>
            <div>• Detected Memory: <strong>{recommendation.totalRamGb} GB RAM</strong></div>
            <div>• Detected GPU: <strong>{recommendation.gpuName}</strong></div>
            <div>• Recommended Model: <span className="bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded font-mono text-[11px] border border-indigo-500/20">{recommendation.recommendedModel}</span></div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <input
            type="checkbox"
            id="localLlmEnabled"
            className="w-4 h-4 rounded border-gray-800 bg-surface text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            checked={config.localLlm?.enabled || false}
            onChange={(e) => {
              const defaultLlm = { enabled: e.target.checked, provider: 'ollama' as const, endpoint: 'http://localhost:11434', model: recommendation?.recommendedModel || 'qwen2.5-coder:1.5b' };
              setConfig({
                ...config,
                localLlm: config.localLlm ? { ...config.localLlm, enabled: e.target.checked } : defaultLlm
              });
            }}
          />
          <label htmlFor="localLlmEnabled" className="text-sm font-semibold text-white cursor-pointer select-none">
            Enable Local AI Delegation Tool
          </label>
        </div>

        {config.localLlm?.enabled && (
          <div className="space-y-6 border-t border-gray-800/60 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Local Provider</label>
                <select
                  className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
                  value={config.localLlm.provider}
                  onChange={(e) => setConfig({
                    ...config,
                    localLlm: { ...config.localLlm!, provider: e.target.value as any }
                  })}
                >
                  <option value="ollama">Ollama</option>
                  <option value="openai-compatible">OpenAI-Compatible (e.g. LM Studio)</option>
                </select>
                <span className="text-[10px] text-gray-500 mt-1">Provider protocol to connect to.</span>
              </div>

              <div className="flex flex-col">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Endpoint URL</label>
                <input
                  type="text"
                  className={`w-full bg-surface border focus:ring-1 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner ${
                    config.localLlm.endpoint && !config.localLlm.endpoint.trim().startsWith('http://') && !config.localLlm.endpoint.trim().startsWith('https://')
                      ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-gray-800 focus:border-indigo-500 focus:ring-indigo-500'
                  }`}
                  value={config.localLlm.endpoint}
                  onChange={(e) => setConfig({
                    ...config,
                    localLlm: { ...config.localLlm!, endpoint: e.target.value }
                  })}
                />
                {config.localLlm.endpoint && !config.localLlm.endpoint.trim().startsWith('http://') && !config.localLlm.endpoint.trim().startsWith('https://') && (
                  <span className="text-[10px] text-rose-400 mt-1">Endpoint must start with http:// or https://</span>
                )}
                <span className="text-[10px] text-gray-500 mt-1">API base address of the local runner.</span>
              </div>

              <div className="flex flex-col md:col-span-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Model Name</label>
                <input
                  type="text"
                  className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
                  value={config.localLlm.model}
                  onChange={(e) => setConfig({
                    ...config,
                    localLlm: { ...config.localLlm!, model: e.target.value }
                  })}
                />
                <span className="text-[10px] text-gray-500 mt-1">Exact name of the model registered on the server (e.g., <code>qwen2.5-coder:1.5b</code>).</span>
              </div>

              {config.localLlm.provider === 'openai-compatible' && (
                <div className="flex flex-col md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">API Key (Optional)</label>
                  <input
                    type="password"
                    className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-605 transition-all outline-none text-sm shadow-inner"
                    value={config.localLlm.apiKey || ''}
                    placeholder="sk-..."
                    onChange={(e) => setConfig({
                      ...config,
                      localLlm: { ...config.localLlm!, apiKey: e.target.value }
                    })}
                  />
                  <span className="text-[10px] text-gray-500 mt-1">Bearer token for authenticating with cloud LLM providers (e.g. OpenAI, DeepSeek, OpenRouter).</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-800/40">
              <button
                type="button"
                disabled={testingLlm}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-indigo-500/20 rounded-lg text-xs font-semibold bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 transition-all cursor-pointer disabled:opacity-40"
                onClick={testLlmConnection}
              >
                {testingLlm ? 'Testing...' : 'Test Connection'}
              </button>

              {testStatus && (
                <div className={`text-xs px-3 py-1.5 rounded-lg border ${
                  testStatus.success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}>
                  {testStatus.message}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Toolchain Updates */}
      <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mt-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">AI Toolchain Updates</h3>
            <p className="text-xs text-content-faint">Monitor and update the CLI packages and assistants in your workflow.</p>
          </div>
          <button
            onClick={() => fetchToolsStatus(true)}
            disabled={toolsLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-800 hover:border-gray-700 bg-gray-950/20 text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={toolsLoading ? 'animate-spin' : ''} />
            {toolsLoading ? 'Checking...' : 'Check Now'}
          </button>
        </div>

        {toolsLoading && toolsStatus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-content-faint">
            <RefreshCw className="animate-spin text-indigo-400" size={24} />
            <span className="text-xs">Fetching registry version details...</span>
          </div>
        ) : toolsStatus.length === 0 ? (
          <p className="text-xs text-content-faint py-4">No toolchain information available.</p>
        ) : (
          <div className="space-y-4">
            {toolsStatus.map((tool) => (
              <div key={tool.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border border-gray-800/60 rounded-xl bg-gray-950/10">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    {tool.name}
                    <span className={`text-[9px] px-2 py-0.5 rounded font-semibold uppercase ${
                      tool.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500'
                    }`}>
                      {tool.installed ? 'Installed' : 'Not Installed'}
                    </span>
                  </h4>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-content-faint">
                    <span>Installed version: <code className="text-content font-mono text-[10px]">{tool.currentVersion}</code></span>
                    {tool.installed && (
                      <span>Latest: <code className="text-content font-mono text-[10px]">{tool.latestVersion}</code></span>
                    )}
                  </div>
                  <p className="text-[10px] text-content-faint mt-1 font-mono">{tool.updateCmd}</p>
                </div>

                <div className="shrink-0 flex items-center gap-3">
                  {tool.updateAvailable ? (
                    <button
                      onClick={() => handleUpdateTool(tool.id)}
                      disabled={updatingToolId !== null}
                      className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-[#060813] font-bold text-xs rounded-lg transition-all shadow-md shadow-amber-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {updatingToolId === tool.id
                        ? (<><RefreshCw className="animate-spin" size={12} /> Updating...</>)
                        : (<><Sparkles size={12} /> Update Tool</>)}
                    </button>
                  ) : tool.installed ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 bg-emerald-500/5 px-2.5 py-1.5 rounded-lg border border-emerald-500/10">
                        <Check size={12} /> Up to Date
                      </span>
                      <button
                        onClick={() => handleUpdateTool(tool.id)}
                        disabled={updatingToolId !== null}
                        className="px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 text-content font-bold text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {updatingToolId === tool.id
                          ? (<><RefreshCw className="animate-spin" size={12} /> Reinstalling...</>)
                          : 'Reinstall'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleUpdateTool(tool.id)}
                      disabled={updatingToolId !== null}
                      className="px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white font-bold text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {updatingToolId === tool.id
                        ? (<><RefreshCw className="animate-spin" size={12} /> Installing...</>)
                        : 'Install CLI'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4 mb-10">
        <button
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors cursor-pointer disabled:opacity-50"
          onClick={() => saveAppConfig(config)}
          disabled={!isSettingsFormValid}
        >
          <Check size={16} /> Save Configuration
        </button>
      </div>

    </div>
  );
}
