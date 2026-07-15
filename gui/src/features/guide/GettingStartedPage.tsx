import { PlusCircle, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { NexusFlowConfig } from '../../types.js';

interface GettingStartedPageProps {
  config: NexusFlowConfig;
  onCreateWorkspace: () => void;
  onModifySettings: () => void;
}

export function GettingStartedPage({
  config,
  onCreateWorkspace,
  onModifySettings,
}: GettingStartedPageProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-10">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold uppercase tracking-wider mb-4">
          <Sparkles size={12} className="text-cyan-400" /> Getting Started Guide
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-white via-gray-200 to-indigo-300 bg-clip-text text-transparent">
          Welcome to NexusFlow
        </h1>
        <p className="text-sm text-gray-400">
          NexusFlow orchestrates multi-repository developer environments. It combines isolated Git worktrees, automatic code analyzer sweeps, and background process running into a single dashboard.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        {/* Left: Interactive Stepper */}
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-6 shadow-xl backdrop-blur-sm space-y-6">
          <h2 className="text-lg font-bold text-white mb-4">NexusFlow Workflows</h2>
          
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
              1
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Configure Folders</h3>
              <p className="text-xs text-gray-400 mt-1">
                Specify your Development folder (where repositories live) and Workspaces folder. These are currently set to:
                <code className="block mt-1 text-[10px] text-indigo-300 break-all">{config.devDir || 'Not Configured'}</code>
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
              2
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Build Workspaces</h3>
              <p className="text-xs text-gray-400 mt-1">
                Choose repositories and feature branch. NexusFlow checks out dependencies under a unified workspace directory using Git Worktrees, keeping original projects clean.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
              3
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Align AI Context</h3>
              <p className="text-xs text-gray-400 mt-1">
                NexusFlow writes files like <code>CLAUDE.md</code>, <code>.cursorrules</code>, <code>AGENTS.md</code> prompting the LLM to inspect project relations and list key assumptions and questions before coding.
              </p>
            </div>
          </div>


        </div>

        {/* Right: Quick actions and Telemetry info */}
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white mb-4">Current Configuration</h2>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-gray-800/60">
                <span className="text-gray-500">Dev Folder:</span>
                <span className="text-gray-300 font-mono text-[10px] truncate max-w-[200px]">{config.devDir}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-800/60">
                <span className="text-gray-500">Workspaces Folder:</span>
                <span className="text-gray-300 font-mono text-[10px] truncate max-w-[200px]">{config.workspacesDir}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-800/60">
                <span className="text-gray-500">Preferred AI:</span>
                <span className="text-indigo-400 font-semibold uppercase">{config.defaultAssistant || 'None'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-500">Scan Depth:</span>
                <span className="text-gray-300 font-semibold">{config.scanDepth} levels</span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-800/60 flex flex-col gap-2">
            <button
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-md shadow-indigo-500/10 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
              onClick={onCreateWorkspace}
            >
              <PlusCircle size={14} /> Create a Workspace
            </button>
            <button
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
              onClick={onModifySettings}
            >
              <SettingsIcon size={14} className="text-gray-500" /> Modify Settings
            </button>
          </div>
        </div>
      </div>

      {/* Compare dashboard at the bottom */}
      <div className="bg-surface/20 border border-gray-800/80 rounded-xl p-6 shadow-md">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Industry Comparison</h4>
        <div className="overflow-x-auto">
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
  );
}
