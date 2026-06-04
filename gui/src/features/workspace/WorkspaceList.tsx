import React from 'react';
import { Play, RefreshCw, FolderGit2, Sparkles, ExternalLink, Trash2 } from 'lucide-react';
import type { Feature, RunningService, ServiceConfig, OrchestrationDetection, RepoInfo } from '../../types.js';

// Feature subcomponents
import { SessionHistory } from '../sessions/SessionHistory.js';
import { ServiceConsole } from '../services/ServiceConsole.js';
import { ChangesViewer } from '../changes/ChangesViewer.js';
import { KnowledgeBase } from '../knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../plan/ImplementationPlan.js';

interface WorkspaceListProps {
  workspacesLoading: boolean;
  workspaces: Feature[];
  activeWsId: string | null;
  setActiveWsId: (id: string | null) => void;
  resumingWs: string | null;
  handleResumeSession: (ws: Feature, sessionId?: string, assistant?: string) => Promise<void>;
  handleCopyPrompt: (ws: Feature) => void;
  handleOpenInEditor: (workspacePath: string) => Promise<void>;
  fetchWorkspaces: () => Promise<void>;
  
  // Deletion and repo addition props
  repos: RepoInfo[];
  deleteWsLoading: string | null;
  addRepoLoading: boolean;
  handleDeleteWorkspace: (wsName: string) => Promise<void>;
  handleAddRepo: (wsName: string, repoPath: string) => Promise<void>;
  
  // ServiceConsole props
  services: ServiceConfig[];
  runningServices: RunningService[];
  selectedLogService: string | null;
  serviceLogs: string;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  setSelectedLogService: (val: string | null) => void;
  handleStartServices: (wsId: string) => Promise<void>;
  handleStopServices: (wsId: string) => Promise<void>;
  orchTools: OrchestrationDetection[];
  servicesLoading: boolean;


  // ChangesViewer props
  gitChanges: any[];
  gitChangesLoading: boolean;
  syncLoading: boolean;
  syncResults: any[] | null;
  commitMessage: string;
  showCommitModal: boolean;
  commitLoading: boolean;
  commitResults: any[] | null;
  setSyncResults: (val: any[] | null) => void;
  setCommitResults: (val: any[] | null) => void;
  setCommitMessage: (val: string) => void;
  setShowCommitModal: (val: boolean) => void;
  fetchGitChanges: (wsId: string) => Promise<void>;
  handleSyncAll: (wsId: string) => Promise<void>;
  handleCommitAll: (wsId: string) => Promise<void>;

  // KnowledgeBase props
  knowledgeContent: string;
  knowledgeLoading: boolean;
  isEditingKnowledge: boolean;
  editedKnowledge: string;
  saveKnowledgeLoading: boolean;
  setEditedKnowledge: (val: string) => void;
  setIsEditingKnowledge: (val: boolean) => void;
  handleSaveKnowledge: (wsId: string) => Promise<void>;

  // ImplementationPlan props
  planContent: string;
  planLoading: boolean;

  // SessionHistory props
  sessions: any[];
  sessionsLoading: boolean;
  activeSession: any | null;
  transcript: any[];
  transcriptLoading: boolean;
  setActiveSession: (val: any | null) => void;
  setTranscript: (val: any[]) => void;
  fetchSessionTranscript: (assistant: string, sessionId: string) => Promise<void>;

  // Navigation tab states
  subTab: any;
  setSubTab: (tab: any) => void;
}

const parseInlineStyles = (text: string): React.ReactNode => {
  const tokenRegex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
  const parts = text.split(tokenRegex);
  
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-bold text-gray-200">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="px-1.5 py-0.5 bg-gray-900 border border-gray-800 text-indigo-300 rounded font-mono text-[10px]">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index} className="italic text-gray-300">{part.slice(1, -1)}</em>;
    }
    return part;
  });
};

const renderFormattedDescription = (text: string) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  
  const flushList = (key: number) => {
    if (currentList) {
      const ListTag = currentList.type;
      elements.push(
        <ListTag key={`list-${key}`} className={currentList.type === 'ul' ? 'list-disc pl-5 my-1.5 space-y-1' : 'list-decimal pl-5 my-1.5 space-y-1'}>
          {currentList.items.map((item, idx) => (
            <li key={`item-${idx}`} className="leading-relaxed">{parseInlineStyles(item)}</li>
          ))}
        </ListTag>
      );
      currentList = null;
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // Check for bullet list item
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList(idx);
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[2]);
      return;
    }
    
    // Check for numbered list item
    const numberMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (numberMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList(idx);
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numberMatch[2]);
      return;
    }
    
    // If not a list item, flush any active list first
    flushList(idx);
    
    if (trimmed === '') {
      elements.push(<div key={`empty-${idx}`} className="h-2" />);
    } else {
      elements.push(
        <div key={`line-${idx}`} className="leading-relaxed">
          {parseInlineStyles(line)}
        </div>
      );
    }
  });
  
  flushList(lines.length);
  return <div className="space-y-1">{elements}</div>;
};

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  workspacesLoading,
  workspaces,
  activeWsId,
  setActiveWsId,
  resumingWs,
  handleResumeSession,
  handleCopyPrompt,
  handleOpenInEditor,
  fetchWorkspaces,
  repos,
  deleteWsLoading,
  addRepoLoading,
  handleDeleteWorkspace,
  handleAddRepo,

  // ServiceConsole
  services,
  runningServices,
  selectedLogService,
  serviceLogs,
  logsEndRef,
  setSelectedLogService,
  handleStartServices,
  handleStopServices,
  orchTools,
  servicesLoading,


  // ChangesViewer
  gitChanges,
  gitChangesLoading,
  syncLoading,
  syncResults,
  commitMessage,
  showCommitModal,
  commitLoading,
  commitResults,
  setSyncResults,
  setCommitResults,
  setCommitMessage,
  setShowCommitModal,
  fetchGitChanges,
  handleSyncAll,
  handleCommitAll,

  // KnowledgeBase
  knowledgeContent,
  knowledgeLoading,
  isEditingKnowledge,
  editedKnowledge,
  saveKnowledgeLoading,
  setEditedKnowledge,
  setIsEditingKnowledge,
  handleSaveKnowledge,

  // ImplementationPlan
  planContent,
  planLoading,

  // SessionHistory
  sessions,
  sessionsLoading,
  activeSession,
  transcript,
  transcriptLoading,
  setActiveSession,
  setTranscript,
  fetchSessionTranscript,

  // Tabs
  subTab,
  setSubTab,
}) => {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Active Workspaces</h1>
          <p className="text-sm text-gray-400">Monitor running servers, libraries, and processes on your development branches.</p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
          onClick={fetchWorkspaces}
          disabled={workspacesLoading}
        >
          <RefreshCw size={14} className={workspacesLoading ? 'animate-spin text-indigo-400' : ''} /> Refresh
        </button>
      </header>

      {workspacesLoading ? (
        <div className="flex flex-col items-center py-40 gap-4 text-gray-400">
          <RefreshCw className="animate-spin text-indigo-400" size={32} />
          <span className="text-sm">Fetching workspace details...</span>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-[#111827]/20 border border-gray-800/80 rounded-xl text-center">
          <FolderGit2 size={44} className="text-gray-600 mb-4" />
          <h3 className="text-lg font-bold text-white">No Active Workspaces</h3>
          <p className="text-xs text-gray-505 max-w-sm mt-1">
            No feature workspaces were detected in your development folder. Create a workspace to start.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {workspaces.map((ws) => {
            const isExpanded = activeWsId === ws.branchName;
            return (
              <div key={ws.id} className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-6 shadow-md">
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white hover:text-indigo-400 transition-colors">{ws.branchName}</h3>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                      <span>Created: {new Date(ws.createdAt).toLocaleDateString()}</span>
                      <span className="h-1 w-1 rounded-full bg-gray-700"></span>
                      <span>{ws.repos.length} repos</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-650 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-md shadow-emerald-600/10 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => handleResumeSession(ws)}
                      disabled={resumingWs === ws.branchName}
                    >
                      <Play size={12} className={resumingWs === ws.branchName ? 'animate-spin' : ''} />
                      {resumingWs === ws.branchName ? 'Resuming...' : 'Resume Session'}
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                      onClick={() => handleCopyPrompt(ws)}
                    >
                      <Sparkles size={12} className="text-cyan-400" /> Copy Prompt
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                      onClick={() => handleOpenInEditor(ws.workspacePath)}
                    >
                      <ExternalLink size={12} /> Open
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-md shadow-indigo-500/10"
                      onClick={() => {
                        if (isExpanded) {
                          setActiveWsId(null);
                        } else {
                          setActiveWsId(ws.branchName);
                        }
                      }}
                    >
                      {isExpanded ? 'Hide Runner' : 'Orchestrate'}
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-red-950/40 border border-red-900/60 hover:bg-red-900/60 hover:border-red-800 rounded-lg text-xs font-semibold text-red-200 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed animate-fade-in"
                      onClick={() => handleDeleteWorkspace(ws.branchName)}
                      disabled={deleteWsLoading === ws.branchName}
                    >
                      <Trash2 size={12} className={deleteWsLoading === ws.branchName ? 'animate-spin' : ''} />
                      {deleteWsLoading === ws.branchName ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-400 bg-gray-950/40 border-l-2 border-indigo-500 rounded-r-lg px-4 py-3 mb-4 font-medium italic">
                  {renderFormattedDescription(ws.description)}
                </div>

                <div className="flex items-center gap-3 mb-4">
                  <div className="flex flex-wrap gap-2">
                    {ws.repos.map((repoPath) => (
                      <span key={repoPath} className="text-[10px] px-2.5 py-1 bg-gray-900 border border-gray-800 text-gray-300 rounded-md font-semibold">
                        {repoPath.split(/[\\/]/).pop()}
                      </span>
                    ))}
                  </div>

                  {repos.filter((r) => !ws.repos.includes(r.path)).length > 0 && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <select
                        id={`add-repo-select-feature-${ws.branchName}`}
                        className="bg-gray-900 border border-gray-800 text-gray-300 rounded-md text-[10px] px-2 py-1 font-semibold outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        defaultValue=""
                        onChange={async (e) => {
                          const val = e.target.value;
                          if (val) {
                            if (window.confirm(`Are you sure you want to add repository "${val.split(/[\\/]/).pop()}" to this workspace?\nThis will create a new git worktree and re-run analysis.`)) {
                              await handleAddRepo(ws.branchName, val);
                            }
                            e.target.value = "";
                          }
                        }}
                        disabled={addRepoLoading}
                      >
                        <option value="" disabled>+ Add Repository</option>
                        {repos
                          .filter((r) => !ws.repos.includes(r.path))
                          .map((r) => (
                            <option key={r.path} value={r.path}>{r.name}</option>
                          ))
                        }
                      </select>
                    </div>
                  )}
                </div>

                {/* Expansion: Process management console */}
                {isExpanded && (
                  <div className="mt-6 pt-6 border-t border-gray-800/80">
                    {/* Sub-tab Navigation */}
                    <div className="flex border-b border-gray-800/80 mb-6 gap-2">
                      <button
                        className={`px-4 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer ${
                          subTab === 'sessions'
                            ? 'border-indigo-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        onClick={() => setSubTab('sessions')}
                      >
                        AI Session History
                      </button>
                      <button
                        className={`px-4 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer ${
                          subTab === 'services'
                            ? 'border-indigo-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        onClick={() => setSubTab('services')}
                      >
                        Orchestrated Services
                      </button>
                      <button
                        className={`px-4 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer ${
                          subTab === 'changes'
                            ? 'border-indigo-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        onClick={() => setSubTab('changes')}
                      >
                        Active Changes (AI Diffs)
                      </button>
                      <button
                        className={`px-4 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer ${
                          subTab === 'knowledge'
                            ? 'border-indigo-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        onClick={() => setSubTab('knowledge')}
                      >
                        Knowledge Base
                      </button>
                      <button
                        className={`px-4 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer ${
                          subTab === 'plan'
                            ? 'border-indigo-500 text-white'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                        onClick={() => setSubTab('plan')}
                      >
                        Implementation Plan
                      </button>
                    </div>

                    {subTab === 'sessions' && (
                      <SessionHistory
                        ws={ws}
                        sessions={sessions}
                        sessionsLoading={sessionsLoading}
                        activeSession={activeSession}
                        transcript={transcript}
                        transcriptLoading={transcriptLoading}
                        workspaces={workspaces}
                        setActiveSession={setActiveSession}
                        setTranscript={setTranscript}
                        fetchSessionTranscript={fetchSessionTranscript}
                        handleResumeSession={handleResumeSession}
                      />
                    )}

                    {subTab === 'services' && (
                      <ServiceConsole
                        ws={ws}
                        services={services}
                        runningServices={runningServices}
                        selectedLogService={selectedLogService}
                        serviceLogs={serviceLogs}
                        logsEndRef={logsEndRef}
                        setSelectedLogService={setSelectedLogService}
                        handleStartServices={handleStartServices}
                        handleStopServices={handleStopServices}
                        orchTools={orchTools}
                        servicesLoading={servicesLoading}
                      />
                    )}

                    {subTab === 'changes' && (
                      <ChangesViewer
                        ws={ws}
                        gitChanges={gitChanges}
                        gitChangesLoading={gitChangesLoading}
                        syncLoading={syncLoading}
                        syncResults={syncResults}
                        commitMessage={commitMessage}
                        showCommitModal={showCommitModal}
                        commitLoading={commitLoading}
                        commitResults={commitResults}
                        setSyncResults={setSyncResults}
                        setCommitResults={setCommitResults}
                        setCommitMessage={setCommitMessage}
                        setShowCommitModal={setShowCommitModal}
                        fetchGitChanges={fetchGitChanges}
                        handleSyncAll={handleSyncAll}
                        handleCommitAll={handleCommitAll}
                      />
                    )}

                    {subTab === 'knowledge' && (
                      <KnowledgeBase
                        ws={ws}
                        knowledgeContent={knowledgeContent}
                        knowledgeLoading={knowledgeLoading}
                        isEditingKnowledge={isEditingKnowledge}
                        editedKnowledge={editedKnowledge}
                        saveKnowledgeLoading={saveKnowledgeLoading}
                        setEditedKnowledge={setEditedKnowledge}
                        setIsEditingKnowledge={setIsEditingKnowledge}
                        handleSaveKnowledge={handleSaveKnowledge}
                      />
                    )}

                    {subTab === 'plan' && (
                      <ImplementationPlan
                        planContent={planContent}
                        planLoading={planLoading}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
