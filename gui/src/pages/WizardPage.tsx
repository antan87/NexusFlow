import React from 'react';
import { 
  Check, Search, RefreshCw, ArrowLeft, ArrowRight, 
  AlertTriangle, AlertCircle, Terminal, Cpu, FolderOpen, Sparkles 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NexusFlowConfig, RepoInfo, DetectedAI, DetectedEditor } from '../types.js';

interface WizardPageProps {
  activeStep: number;
  setActiveStep: React.Dispatch<React.SetStateAction<number>>;
  branchName: string;
  setBranchName: React.Dispatch<React.SetStateAction<string>>;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  repos: RepoInfo[];
  reposLoading: boolean;
  repoSearch: string;
  setRepoSearch: React.Dispatch<React.SetStateAction<string>>;
  selectedRepos: RepoInfo[];
  setSelectedRepos: React.Dispatch<React.SetStateAction<RepoInfo[]>>;
  
  aiAssistants: DetectedAI[];
  selectedAI: string[];
  setSelectedAI: React.Dispatch<React.SetStateAction<string[]>>;
  
  editors: DetectedEditor[];
  selectedEditor: DetectedEditor | null;
  setSelectedEditor: React.Dispatch<React.SetStateAction<DetectedEditor | null>>;
  
  config: NexusFlowConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<NexusFlowConfig | null>>;
  saveAppConfig: (c: NexusFlowConfig) => Promise<void>;
  
  localLlmEnabled: boolean;
  setLocalLlmEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  
  testCommand: string;
  setTestCommand: React.Dispatch<React.SetStateAction<string>>;
  mockCommand: string;
  setMockCommand: React.Dispatch<React.SetStateAction<string>>;
  startCommand: string;
  setStartCommand: React.Dispatch<React.SetStateAction<string>>;
  
  suggestingWorkflow: boolean;
  handleSuggestWorkflow: () => Promise<void>;
  suggestedDifficulty: 'simple' | 'moderate' | 'complex' | null;
  suggestedRationale: string;
  
  workflowTemplates: any[];
  selectedWorkflowId: string;
  setSelectedWorkflowId: React.Dispatch<React.SetStateAction<string>>;
  customTeamworkInstructions: string;
  setCustomTeamworkInstructions: React.Dispatch<React.SetStateAction<string>>;
  
  creating: boolean;
  handleCreateWorkspace: () => Promise<void>;
  creationSteps: any[];
  creationError: string | null;
  setCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCreationError: React.Dispatch<React.SetStateAction<string | null>>;
  
  createdWorkspace: { path: string } | null;
  fetchWorkspaces: () => Promise<void>;
  handleOpenInEditor: (path: string) => Promise<void>;
}

export function WizardPage(props: WizardPageProps) {
  const navigate = useNavigate();
  
  const {
    activeStep, setActiveStep,
    branchName, setBranchName,
    description, setDescription,
    repos, reposLoading, repoSearch, setRepoSearch,
    selectedRepos, setSelectedRepos,
    aiAssistants, selectedAI, setSelectedAI,
    editors, selectedEditor, setSelectedEditor,
    config, setConfig, saveAppConfig,
    localLlmEnabled, setLocalLlmEnabled,
    testCommand, setTestCommand,
    mockCommand, setMockCommand,
    startCommand, setStartCommand,
    suggestingWorkflow, handleSuggestWorkflow,
    suggestedDifficulty, suggestedRationale,
    workflowTemplates, selectedWorkflowId, setSelectedWorkflowId,
    customTeamworkInstructions, setCustomTeamworkInstructions,
    creating, handleCreateWorkspace,
    creationSteps, creationError, setCreating, setCreationError,
    createdWorkspace, fetchWorkspaces, handleOpenInEditor
  } = props;

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const handleToggleRepo = (repo: RepoInfo) => {
    setSelectedRepos((prev) => {
      if (prev.find((r) => r.path === repo.path)) {
        return prev.filter((r) => r.path !== repo.path);
      } else {
        return [...prev, repo];
      }
    });
  };

  const handleToggleAI = (aiName: string) => {
    setSelectedAI((prev) => {
      if (prev.includes(aiName)) {
        return prev.filter((a) => a !== aiName);
      } else {
        return [...prev, aiName];
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">New Feature Workspace</h1>
        <p className="text-sm text-gray-400">
          Set up unified git worktrees, scan tech stacks, and write contextual configurations for your AI assistant.
        </p>
      </header>

      {/* Progress Circle bar */}
      <div className="flex justify-between items-center max-w-2xl mx-auto mb-14 relative px-4">
        <div className="absolute top-4 left-6 right-6 h-[2px] bg-gray-800 -z-10"></div>
        <div
          className="absolute top-4 left-6 h-[2px] bg-gradient-to-r from-cyan-400 to-indigo-500 -z-10 transition-all duration-300"
          style={{ width: `${(activeStep / 4) * 95}%` }}
        ></div>
        <div className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
            activeStep > 0 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 0 ? 'border-indigo-500 bg-surface text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
          }`}>
            {activeStep > 0 ? <Check size={14} /> : '1'}
          </div>
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 0 ? 'text-white' : 'text-gray-500'}`}>Details</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
            activeStep > 1 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 1 ? 'border-indigo-500 bg-surface text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
          }`}>
            {activeStep > 1 ? <Check size={14} /> : '2'}
          </div>
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 1 ? 'text-white' : 'text-gray-500'}`}>Repos</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
            activeStep > 2 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 2 ? 'border-indigo-500 bg-surface text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
          }`}>
            {activeStep > 2 ? <Check size={14} /> : '3'}
          </div>
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 2 ? 'text-white' : 'text-gray-500'}`}>Assistant</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
            activeStep > 3 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 3 ? 'border-indigo-500 bg-surface text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
          }`}>
            {activeStep > 3 ? <Check size={14} /> : '4'}
          </div>
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 3 ? 'text-white' : 'text-gray-500'}`}>Strategy</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
            activeStep === 4 ? 'border-emerald-500 bg-surface text-emerald-400 shadow-lg shadow-emerald-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
          }`}>
            5
          </div>
          <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 4 ? 'text-emerald-400' : 'text-gray-500'}`}>Complete</span>
        </div>
      </div>

      {/* Step 0: Name & Description */}
      {activeStep === 0 && (
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
          <div className="mb-6">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feature Branch Name</label>
            <input
              type="text"
              className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
              placeholder="e.g., feature/oauth-authentication-flow"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
          </div>
          <div className="mb-8">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feature Purpose & Context</label>
            <textarea
              className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm min-h-[140px] resize-y shadow-inner"
              placeholder="Describe what you want to build. This helps AI assistants analyze context and produce matching plans."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-md shadow-indigo-500/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
              disabled={!branchName || !description}
              onClick={() => setActiveStep(1)}
            >
              Next Step <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Repo Selector */}
      {activeStep === 1 && (
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-6">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Select Repositories</label>
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-3 text-gray-500" />
              <input
                type="text"
                className="w-full bg-surface border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg pl-9 pr-4 py-2 text-white placeholder-gray-600 transition-all outline-none text-xs"
                placeholder="Search repo name..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
              />
            </div>
          </div>

          {reposLoading ? (
            <div className="flex flex-col items-center py-20 gap-3 text-gray-500">
              <RefreshCw className="animate-spin text-indigo-400" size={24} />
              <span className="text-xs">Scanning local projects directory...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[380px] overflow-y-auto p-2 border border-gray-800/60 rounded-lg bg-gray-950/20 mb-8">
              {filteredRepos.map((repo) => {
                const isSelected = selectedRepos.some((r) => r.path === repo.path);
                return (
                  <div
                    key={repo.path}
                    className={`bg-surface/60 border rounded-xl p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-800/20 hover:border-gray-700 transition-all ${
                      isSelected ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                    }`}
                    onClick={() => handleToggleRepo(repo)}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-indigo-500 rounded cursor-pointer"
                      checked={isSelected}
                      readOnly
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{repo.name}</div>
                      <div className="text-[10px] text-gray-500 truncate mt-1">{repo.path}</div>
                    </div>
                    <span className="text-[9px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-semibold uppercase">{repo.defaultBranch}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-between">
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
              onClick={() => setActiveStep(0)}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-md shadow-indigo-500/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
              disabled={selectedRepos.length === 0}
              onClick={() => setActiveStep(2)}
            >
              Next Step <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: AI & Editor Settings */}
      {activeStep === 2 && (
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
          {creating ? (
            <div className="flex flex-col items-center py-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2.5">
                <RefreshCw className="animate-spin text-indigo-400" size={20} />
                Building Workspace...
              </h3>
              <p className="text-xs text-gray-400 mb-8">
                Setting up your multi-repo workspace. This will take a moment.
              </p>

              <div className="w-full max-w-md space-y-4">
                {creationSteps.map((step) => {
                  const isPending = step.status === 'pending';
                  const isRunning = step.status === 'running';
                  const isCompleted = step.status === 'completed';
                  const isFailed = step.status === 'failed';

                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 ${
                        isRunning
                          ? 'bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                          : isCompleted
                          ? 'bg-emerald-500/5 border-emerald-500/20 opacity-80'
                          : isFailed
                          ? 'bg-rose-500/5 border-rose-500/30'
                          : 'bg-gray-900/20 border-gray-800/40 opacity-40'
                      }`}
                    >
                      <div className="mt-0.5">
                        {isRunning && (
                          <div className="relative flex h-5 w-5 items-center justify-center">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                            <RefreshCw className="animate-spin text-indigo-400 relative" size={16} />
                          </div>
                        )}
                        {isCompleted && (
                          <div className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                            <Check size={12} />
                          </div>
                        )}
                        {isFailed && (
                          <div className="h-5 w-5 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                            <AlertTriangle size={12} />
                          </div>
                        )}
                        {isPending && (
                          <div className="h-5 w-5 rounded-full border-2 border-gray-800 flex items-center justify-center text-gray-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-800"></div>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className={`text-sm font-bold truncate ${
                          isRunning ? 'text-indigo-400' : isCompleted ? 'text-emerald-400' : isFailed ? 'text-rose-400' : 'text-gray-500'
                        }`}>
                          {step.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 font-mono break-words leading-relaxed">
                          {step.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {creationError && (
                <div className="mt-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-450 rounded-xl text-xs w-full max-w-md flex flex-col gap-3">
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertCircle size={14} className="text-rose-450" /> Build Failed
                  </span>
                  <span className="font-mono">{creationError}</span>
                  <button
                    className="w-full mt-2 py-2 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors cursor-pointer"
                    onClick={() => {
                      setCreating(false);
                      setCreationError(null);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-8">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Target AI Assistant(s)</label>
                <p className="text-xs text-gray-500 mb-4">
                  We generate context configurations matching the specifications of each checked assistant.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {aiAssistants.map((ai) => {
                    const isSelected = selectedAI.includes(ai.name);
                    return (
                      <div
                        key={ai.name}
                        className={`bg-surface/60 border rounded-xl p-4 flex flex-col gap-3 cursor-pointer hover:border-gray-700 transition-all ${
                          isSelected ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                        }`}
                        onClick={() => handleToggleAI(ai.name)}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-white">{ai.displayName}</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded font-semibold uppercase ${
                            ai.detected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500'
                          }`}>
                            {ai.detected ? 'Installed' : 'Missing'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500">
                          {ai.name === 'claude' && 'CLAUDE.md guidelines'}
                          {ai.name === 'antigravity' && 'CLAUDE.md guidelines (harness)'}
                          {ai.name === 'codex' && 'AGENTS.md config structure'}
                          {ai.name === 'copilot' && 'GitHub Copilot Workspace configs'}
                          {ai.name === 'cursor' && 'Cursor MDC rules and instructions'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-8">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Open Workspace In</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {editors.map((ed) => {
                    const isSelected = selectedEditor?.command === ed.command;
                    return (
                      <div
                        key={ed.command}
                        className={`bg-surface/60 border rounded-xl p-4 flex flex-col cursor-pointer hover:border-gray-700 transition-all ${
                          isSelected ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                        }`}
                        onClick={() => {
                          setSelectedEditor(ed);
                          if (config) {
                            const updatedConfig = { ...config, defaultEditor: ed.command };
                            setConfig(updatedConfig);
                            saveAppConfig(updatedConfig);
                          }
                        }}
                      >
                        <span className="text-sm font-bold text-white">{ed.name}</span>
                        <span className={`text-[9px] mt-2 w-max px-2 py-0.5 rounded font-semibold uppercase ${
                          ed.detected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500'
                        }`}>
                          {ed.detected ? 'Detected' : 'Missing'}
                        </span>
                      </div>
                    );
                  })}
                  <div
                    className={`bg-surface/60 border rounded-xl p-4 flex flex-col cursor-pointer hover:border-gray-700 transition-all ${
                      selectedEditor === null ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                    }`}
                    onClick={() => {
                      setSelectedEditor(null);
                      if (config) {
                        const updatedConfig = { ...config, defaultEditor: 'none' };
                        setConfig(updatedConfig);
                        saveAppConfig(updatedConfig);
                      }
                    }}
                  >
                    <span className="text-sm font-bold text-white">None</span>
                    <span className="text-[9px] mt-2 w-max px-2 py-0.5 rounded font-semibold uppercase bg-gray-800 text-gray-500">
                      Skip opening
                    </span>
                  </div>
                </div>
              </div>

              <div className={`mb-8 border rounded-xl p-5 ${config?.localLlm?.enabled ? 'border-gray-800/80 bg-gray-950/20' : 'border-gray-800/40 bg-gray-950/10 opacity-60'}`}>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Cpu size={14} className="text-indigo-400" /> Local AI Co-processor
                </h4>
                <p className="text-[11px] text-gray-500 mb-4">
                  Enabling the Local AI Co-processor inserts guidelines in the workspace context files, instructing remote agents to delegate heavy tasks (such as searching, log analysis, and boilerplate generation) to your local Ollama/LM Studio model.
                </p>
                {!config?.localLlm?.enabled && (
                  <p className="text-[11px] text-amber-400/80 mb-3 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Enable a local LLM provider in Settings first.
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="wizardLocalLlmEnabled"
                    className="w-4 h-4 rounded border-gray-800 text-indigo-600 bg-gray-950/20 focus:ring-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    checked={localLlmEnabled}
                    onChange={(e) => setLocalLlmEnabled(e.target.checked)}
                    disabled={!config?.localLlm?.enabled}
                  />
                  <label htmlFor="wizardLocalLlmEnabled" className={`text-xs font-semibold cursor-pointer select-none ${config?.localLlm?.enabled ? 'text-white' : 'text-gray-500 cursor-not-allowed'}`}>
                    Include Local AI Co-processor in this workspace context
                  </label>
                </div>
              </div>

              <div className="mb-8 border border-gray-800/80 rounded-xl p-5 bg-gray-950/20">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Terminal size={14} className="text-indigo-400" /> Advanced Session Resumption Settings
                </h4>
                <p className="text-[11px] text-gray-500 mb-4">
                  Configure setup and verification test commands. AI assistants and the dashboard use these to resume your sessions green.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Verification / Test Command</label>
                    <input
                      type="text"
                      className="w-full bg-[#030408] border border-gray-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none transition-all"
                      placeholder="e.g., npm run test or vitest run"
                      value={testCommand}
                      onChange={(e) => setTestCommand(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Mock / Database Command (Optional)</label>
                      <input
                        type="text"
                        className="w-full bg-[#030408] border border-gray-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none transition-all"
                        placeholder="e.g., docker compose up -d redis"
                        value={mockCommand}
                        onChange={(e) => setMockCommand(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Start / Run Command (Optional)</label>
                      <input
                        type="text"
                        className="w-full bg-[#030408] border border-gray-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none transition-all"
                        placeholder="e.g., npm run start:dev"
                        value={startCommand}
                        onChange={(e) => setStartCommand(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                  onClick={() => setActiveStep(1)}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
                  onClick={() => setActiveStep(3)}
                >
                  Next Step <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Team Strategy */}
      {activeStep === 3 && (
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
          {creating ? (
            <div className="flex flex-col items-center py-6">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2.5">
                <RefreshCw className="animate-spin text-indigo-400" size={20} />
                Building Workspace...
              </h3>
              <p className="text-xs text-gray-400 mb-8">
                Setting up your multi-repo workspace. This will take a moment.
              </p>

              <div className="w-full max-w-md space-y-4">
                {creationSteps.map((step) => {
                  const isPending = step.status === 'pending';
                  const isRunning = step.status === 'running';
                  const isCompleted = step.status === 'completed';
                  const isFailed = step.status === 'failed';

                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 ${
                        isRunning
                          ? 'bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                          : isCompleted
                          ? 'bg-emerald-500/5 border-emerald-500/20 opacity-80'
                          : isFailed
                          ? 'bg-rose-500/5 border-rose-500/30'
                          : 'bg-gray-900/20 border-gray-800/40 opacity-40'
                      }`}
                    >
                      <div className="mt-0.5">
                        {isRunning && (
                          <div className="relative flex h-5 w-5 items-center justify-center">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                            <RefreshCw className="animate-spin text-indigo-400 relative" size={16} />
                          </div>
                        )}
                        {isCompleted && (
                          <div className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                            <Check size={12} />
                          </div>
                        )}
                        {isFailed && (
                          <div className="h-5 w-5 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                            <AlertTriangle size={12} />
                          </div>
                        )}
                        {isPending && (
                          <div className="h-5 w-5 rounded-full border-2 border-gray-800 flex items-center justify-center text-gray-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-800"></div>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className={`text-sm font-bold truncate ${
                          isRunning ? 'text-indigo-400' : isCompleted ? 'text-emerald-400' : isFailed ? 'text-rose-400' : 'text-gray-500'
                        }`}>
                          {step.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 font-mono break-words leading-relaxed">
                          {step.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {creationError && (
                <div className="mt-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-450 rounded-xl text-xs w-full max-w-md flex flex-col gap-3">
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertCircle size={14} className="text-rose-450" /> Build Failed
                  </span>
                  <span className="font-mono">{creationError}</span>
                  <button
                    className="w-full mt-2 py-2 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors cursor-pointer"
                    onClick={() => {
                      setCreating(false);
                      setCreationError(null);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-8">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Team Collaboration Strategy</label>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-indigo-650 hover:bg-indigo-700 text-white font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    onClick={handleSuggestWorkflow}
                    disabled={suggestingWorkflow}
                  >
                    <Sparkles size={12} className={suggestingWorkflow ? "animate-spin" : ""} />
                    {suggestingWorkflow ? "Analyzing..." : "Auto-Suggest Strategy"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Select an agent cooperation pattern. This writes instructions to <code>AGENTS.md</code> directing how the team coordinates.
                </p>
                
                {suggestedDifficulty && (
                  <div className="mb-6 p-4 bg-indigo-950/20 border border-indigo-500/30 rounded-xl text-xs flex flex-col gap-2 shadow-inner">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-300">Suggested Task Difficulty:</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                        suggestedDifficulty === 'simple'
                          ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                          : suggestedDifficulty === 'moderate'
                          ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                          : 'bg-rose-500/20 border border-rose-500/30 text-rose-450'
                      }`}>
                        {suggestedDifficulty}
                      </span>
                    </div>
                    <p className="text-gray-400 leading-relaxed font-sans">
                      {suggestedRationale}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {workflowTemplates.map((template) => {
                    const isSelected = selectedWorkflowId === template.id;
                    return (
                      <div
                        key={template.id}
                        className={`bg-surface/60 border rounded-xl p-4 flex flex-col gap-2 cursor-pointer hover:border-gray-700 transition-all ${
                          isSelected ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                        }`}
                        onClick={() => {
                          setSelectedWorkflowId(template.id);
                          setCustomTeamworkInstructions(template.content);
                        }}
                      >
                        <span className="text-sm font-bold text-white">{template.name}</span>
                        <p className="text-[11px] text-gray-500 leading-relaxed font-sans">
                          {template.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-8">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Cooperation Instructions (AGENTS.md)</label>
                <p className="text-xs text-gray-500 mb-3 font-sans">
                  You can customize these instructions directly. They will be saved in the workspace context.
                </p>
                <textarea
                  className="w-full bg-surface border border-gray-850 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-605 transition-all outline-none text-xs font-mono min-h-[220px] resize-y shadow-inner leading-relaxed"
                  value={customTeamworkInstructions}
                  onChange={(e) => setCustomTeamworkInstructions(e.target.value)}
                  placeholder="Enter custom instructions for how the AI agents should coordinate..."
                />
              </div>

              <div className="flex justify-between">
                <button
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                  onClick={() => setActiveStep(2)}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={creating}
                  onClick={handleCreateWorkspace}
                >
                  {creating ? (
                    <>
                      <RefreshCw className="animate-spin" size={14} /> Building...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> Build Workspace
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Success Screen */}
      {activeStep === 4 && createdWorkspace && (
        <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-10 text-center shadow-xl backdrop-blur-sm">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-6">
            <Check size={36} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Workspace Generated!</h2>
          <p className="text-gray-400 text-sm max-w-lg mx-auto mb-8">
            We spun up git worktrees for your branch <code>{branchName}</code>, analyzed the code architectures, and generated your AI assistant instructions.
          </p>

          <div className="flex flex-col gap-3 bg-gray-950/40 border border-gray-800/60 rounded-xl p-5 w-fit min-w-[360px] mx-auto text-left text-xs mb-8">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 font-medium">Branch name:</span>
              <code className="text-indigo-400 font-bold">{branchName}</code>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-500 font-medium">Location:</span>
              <code className="text-gray-400 font-mono text-[10px] break-all">{createdWorkspace.path}</code>
            </div>
          </div>

          <div className="flex justify-center gap-4">
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
              onClick={() => {
                fetchWorkspaces();
                navigate(`/workspaces/${encodeURIComponent(branchName)}`);
              }}
            >
              <Terminal size={14} className="text-cyan-400" /> Manage Services
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-md shadow-indigo-500/10 transition-all cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
              onClick={() => handleOpenInEditor(createdWorkspace.path)}
            >
              <FolderOpen size={14} /> Open Editor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
