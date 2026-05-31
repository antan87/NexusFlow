import React from 'react';
import { Sparkles, Settings as SettingsIcon, ArrowRight } from 'lucide-react';
import type { NexusFlowConfig } from '../../types.js';

interface OnboardingWizardProps {
  config: NexusFlowConfig;
  defaultPaths: { devDir: string; workspacesDir: string } | null;
  setConfig: (cfg: NexusFlowConfig) => void;
  saveAppConfig: (cfg: NexusFlowConfig) => Promise<void>;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  config,
  defaultPaths,
  setConfig,
  saveAppConfig,
}) => {
  const isFormValid = config.devDir.trim() !== '' && config.workspacesDir.trim() !== '';

  return (
    <div className="flex min-h-screen bg-[#070913] text-gray-100 font-sans items-center justify-center p-6 bg-gradient-to-br from-[#0c0f24] via-[#070913] to-[#04050b]">
      {/* Onboarding Box */}
      <div className="max-w-6xl w-full bg-[#111827]/40 border border-gray-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl grid grid-cols-1 lg:grid-cols-12 gap-10">
        
        {/* Left Column: Onboarding Guide & Concepts */}
        <div className="lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold uppercase tracking-wider mb-4">
              <Sparkles size={12} className="text-cyan-400 animate-pulse" /> Onboarding Guide
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-white via-gray-200 to-indigo-300 bg-clip-text text-transparent">
              Welcome to NexusFlow
            </h1>
            <p className="text-sm text-gray-400 mb-8 max-w-xl">
              NexusFlow orchestrates multi-repository developer environments. It combines isolated Git worktrees, automatic code analyzer sweeps, and background process running into a single dashboard.
            </p>

            {/* Onboarding Steps */}
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                  1
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Configure Development Folders</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Specify your local code path and target workspaces path. For the first setup, these paths start empty so you can explicitly configure them.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                  2
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Build Isolated Branch Workspaces</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Choose repositories and input your feature branch. NexusFlow runs <code>git worktree</code> to checkout dependencies under a unified folder structure, leaving your primary repository directories clean.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                  3
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Align AI Coding Contexts</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    NexusFlow automatically generates configuration files (<code>CLAUDE.md</code>, <code>.cursorrules</code>, <code>AGENTS.md</code>) that instruct the AI assistant to analyze project inter-dependencies, document its assumptions in <code>nexusflow-overview.md</code>, and highlight clarifying questions.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                  4
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Orchestrate Background Services</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Run APIs, database scripts, and frontend watch tasks concurrently from the web portal. Monitor real-time logs inside a unified terminal pane.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Dashboard */}
          <div className="mt-8 pt-6 border-t border-gray-800/80">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Industry Comparison</h4>
            <div className="overflow-x-auto font-sans">
              <table className="w-full text-[10px] text-gray-400 text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="py-2 pr-4 font-semibold">Orchestrator</th>
                    <th className="py-2 px-4 font-semibold">Multi-Repo</th>
                    <th className="py-2 px-4 font-semibold">AI Rules Integration</th>
                    <th className="py-2 pl-4 font-semibold">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-800/40">
                    <td className="py-2 pr-4 font-semibold text-white">Docker Compose</td>
                    <td className="py-2 px-4">Yes (Containers only)</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Medium (VM overhead)</td>
                  </tr>
                  <tr className="border-b border-gray-800/40">
                    <td className="py-2 pr-4 font-semibold text-white">Lerna / Turborepo</td>
                    <td className="py-2 px-4">Monorepo only</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Light</td>
                  </tr>
                  <tr className="border-b border-gray-800/40">
                    <td className="py-2 pr-4 font-semibold text-white">DevPod / Gitpod</td>
                    <td className="py-2 px-4">Yes (Complex config)</td>
                    <td className="py-2 px-4">No</td>
                    <td className="py-2 pl-4">Heavy (Full virtual VM)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-semibold text-indigo-400">NexusFlow</td>
                    <td className="py-2 px-4 text-indigo-300">Yes (Native Worktrees)</td>
                    <td className="py-2 px-4 text-indigo-300">Yes (CLAUDE.md/MDC rules)</td>
                    <td className="py-2 pl-4 text-indigo-300">Extremely Light (Native processes)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Configuration Form */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="bg-gray-950/40 border border-gray-800/80 rounded-2xl p-6 shadow-lg">
            <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <SettingsIcon className="text-indigo-400 animate-spin-slow" size={20} /> Initialize Config
            </h2>
            <p className="text-xs text-gray-500 mb-6">
              Define the directories on your machine. The fields are empty so you can provide your paths.
            </p>

            {/* Form Input fields */}
            <div className="space-y-5">
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Development Directory</label>
                <input
                  type="text"
                  className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-xs shadow-inner"
                  placeholder="e.g. C:\Users\patro\dev"
                  value={config.devDir}
                  onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-[10px] text-gray-500 mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code>{defaultPaths.devDir}</code></span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Workspaces Directory</label>
                <input
                  type="text"
                  className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-xs shadow-inner"
                  placeholder="e.g. C:\Users\patro\dev\workspaces"
                  value={config.workspacesDir}
                  onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-[10px] text-gray-500 mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code>{defaultPaths.workspacesDir}</code></span>
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
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
                  className="px-3 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-rose-900/60 hover:text-rose-400 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  onClick={() => {
                    setConfig({
                      ...config,
                      devDir: '',
                      workspacesDir: '',
                      version: config.version,
                      defaultAssistant: config.defaultAssistant,
                      scanDepth: config.scanDepth,
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
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/20 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all cursor-pointer"
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
};
