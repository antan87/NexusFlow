import { ArrowRight, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { NexusFlowConfig, StorageAdapterMeta } from '../../types.js';

interface OnboardingScreenProps {
  config: NexusFlowConfig;
  setConfig: (config: NexusFlowConfig) => void;
  defaultPaths: { devDir: string; workspacesDir: string } | null;
  adapters: StorageAdapterMeta[];
  saveAppConfig: (config: NexusFlowConfig) => void | Promise<void>;
}

export function OnboardingScreen({
  config,
  setConfig,
  defaultPaths,
  adapters,
  saveAppConfig,
}: OnboardingScreenProps) {
  const isFormValid = config.devDir.trim() !== '' && config.workspacesDir.trim() !== '';

  return (
    <div className="flex min-h-screen bg-[#060813] text-gray-100 font-sans items-center justify-center p-6 bg-gradient-to-br from-[#0b0e24] via-[#060813] to-[#030409]">
      {/* Onboarding Box */}
      <div className="max-w-6xl w-full glass-card border border-slate-800/60 rounded-3xl p-10 shadow-2xl glass-card-glow grid grid-cols-1 lg:grid-cols-12 gap-12 animate-slide-in">
        
        {/* Left Column: Onboarding Guide & Concepts */}
        <div className="lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold uppercase tracking-wider mb-5">
              <Sparkles size={12} className="text-cyan-400 animate-pulse" /> Onboarding Guide
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              Welcome to NexusFlow
            </h1>
            <p className="text-sm text-slate-400 mb-8 max-w-xl leading-relaxed">
              NexusFlow orchestrates multi-repository developer environments. It combines isolated Git worktrees, automatic code analyzer sweeps, and background process running into a single dashboard.
            </p>

            {/* Onboarding Steps */}
            <div className="space-y-6">
              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-colors">
                  1
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">Configure Development Folders</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Specify your local code path and target workspaces path. For the first setup, these paths start empty so you can explicitly configure them.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-colors">
                  2
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">Build Isolated Branch Workspaces</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Choose repositories and input your feature branch. NexusFlow runs <code>git worktree</code> to checkout dependencies under a unified folder structure, leaving your primary repository directories clean.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-colors">
                  3
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">Align AI Coding Contexts</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    NexusFlow automatically generates configuration files (<code>CLAUDE.md</code>, <code>.cursorrules</code>, <code>AGENTS.md</code>) that instruct the AI assistant to analyze project inter-dependencies, document its assumptions in <code>nexusflow-overview.md</code>, and highlight clarifying questions.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-colors">
                  4
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">Orchestrate Background Services</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Run APIs, database scripts, and frontend watch tasks concurrently from the web portal. Monitor real-time logs inside a unified terminal pane.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Dashboard */}
          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Industry Comparison</h4>
            <div className="overflow-x-auto font-sans">
              <table className="w-full text-[10px] text-slate-400 text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="py-2 pr-4 font-semibold">Orchestrator</th>
                    <th className="py-2 px-4 font-semibold">Multi-Repo</th>
                    <th className="py-2 px-4 font-semibold">AI Rules Integration</th>
                    <th className="py-2 pl-4 font-semibold">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-850">
                    <td className="py-2 pr-4 font-semibold text-white">Docker Compose</td>
                    <td className="py-2 px-4">Yes (Containers only)</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Medium (VM overhead)</td>
                  </tr>
                  <tr className="border-b border-slate-850">
                    <td className="py-2 pr-4 font-semibold text-white">Lerna / Turborepo</td>
                    <td className="py-2 px-4">Monorepo only</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Light</td>
                  </tr>
                  <tr className="border-b border-slate-850">
                    <td className="py-2 pr-4 font-semibold text-white">DevPod / Gitpod</td>
                    <td className="py-2 px-4">Yes (Complex config)</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Heavy (Full virtual VM)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-semibold text-indigo-400 text-glow-indigo">NexusFlow</td>
                    <td className="py-2 px-4 text-indigo-300 font-medium">Yes (Native Worktrees)</td>
                    <td className="py-2 px-4 text-indigo-300 font-medium">Yes (CLAUDE.md/MDC rules)</td>
                    <td className="py-2 pl-4 text-indigo-300 font-medium">Extremely Light (Native processes)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Configuration Form */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="bg-slate-950/50 border border-slate-850 rounded-2xl p-8 shadow-xl relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-b before:from-indigo-500/5 before:to-transparent before:pointer-events-none">
            <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <SettingsIcon className="text-indigo-400 animate-spin-slow" size={20} /> Initialize Config
            </h2>
            <p className="text-xs text-slate-500 mb-6">
              Define the directories on your machine. The fields are empty so you can provide your paths.
            </p>

            {/* Form Input fields */}
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Development Directory</label>
                <input
                  type="text"
                  className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/35 rounded-xl px-4 py-3 text-white placeholder-slate-600 transition-all outline-none text-xs shadow-inner"
                  placeholder="e.g. C:\Users\username\dev"
                  value={config.devDir}
                  onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-[10px] text-slate-500 mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code className="text-indigo-300">{defaultPaths.devDir}</code></span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Workspaces Directory</label>
                <input
                  type="text"
                  className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/35 rounded-xl px-4 py-3 text-white placeholder-slate-600 transition-all outline-none text-xs shadow-inner"
                  placeholder="e.g. C:\Users\username\dev\workspaces"
                  value={config.workspacesDir}
                  onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-[10px] text-slate-500 mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code className="text-indigo-300">{defaultPaths.workspacesDir}</code></span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <label htmlFor="onboardingStorageProvider" className="text-xs font-semibold text-slate-200 block mb-1">
                  Storage Provider
                </label>
                <select
                  id="onboardingStorageProvider"
                  className="w-full text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
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
                <span className="text-[10px] text-slate-500 mt-1 block leading-normal">
                  {adapters.find(a => a.name === (config.storageProvider || 'local'))?.description || 
                    'Choose where to store maps, plans, and knowledge files. Centralized vault keeps repositories 100% clean and allows Obsidian integration.'}
                </span>
              </div>

              {/* Form Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-900 border border-slate-800/80 hover:bg-indigo-500/5 hover:border-indigo-500/30 rounded-xl text-xs font-semibold transition-all cursor-pointer text-slate-300 hover:text-white"
                  onClick={() => {
                    if (defaultPaths) {
                      setConfig({
                        ...config,
                        devDir: defaultPaths.devDir,
                        workspacesDir: defaultPaths.workspacesDir,
                      });
                    }
                  }}
                >
                  Suggest Defaults
                </button>
                <button
                  type="button"
                  className="px-3 py-2.5 bg-slate-900 border border-slate-800/80 hover:bg-rose-500/5 hover:border-rose-500/30 hover:text-rose-400 rounded-xl text-xs font-semibold transition-all cursor-pointer text-slate-400"
                  onClick={() => {
                    setConfig({
                      ...config,
                      devDir: '',
                      workspacesDir: '',
                    });
                  }}
                >
                  Clear
                </button>
              </div>

              {/* Save Button */}
              <div className="pt-4">
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-sm font-bold bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-650 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/20 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all cursor-pointer"
                  disabled={!isFormValid}
                  onClick={() => saveAppConfig(config)}
                >
                  Save & Get Started <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
