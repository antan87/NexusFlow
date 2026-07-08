import { Check, AlertTriangle, Cpu } from 'lucide-react';
import type { NexusFlowConfig, StorageAdapterMeta, DetectedEditor } from '../types.js';

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
  testLlmConnection
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

      <div className="flex justify-end pt-4 mb-10">
        <button
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors cursor-pointer disabled:opacity-50"
          onClick={() => saveAppConfig(config)}
          disabled={!isSettingsFormValid}
        >
          <Check size={16} /> Save Settings
        </button>
      </div>

    </div>
  );
}
