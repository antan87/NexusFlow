import { useState, useEffect, useRef } from 'react';
import {
  PlusCircle,
  FolderGit2,
  Settings as SettingsIcon,
  Terminal,
  Play,
  Square,
  ExternalLink,
  Check,
  AlertTriangle,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Search,
  Sparkles,
  Copy,
  X,
  MessageSquare,
  MessageSquareCode,
} from 'lucide-react';
import './App.css';

// Types matched with src/types.ts
interface NexusFlowConfig {
  version: string;
  devDir: string;
  workspacesDir: string;
  defaultAssistant: string | null;
  scanDepth: number;
}

interface DetectedAI {
  name: string;
  displayName: string;
  detected: boolean;
  command?: string;
}

interface DetectedEditor {
  name: string;
  command: string;
  detected: boolean;
}

interface RepoInfo {
  name: string;
  path: string;
  defaultBranch: string;
}

interface Feature {
  id: string;
  branchName: string;
  description: string;
  repos: string[];
  assistants: string[];
  workspacePath: string;
  createdAt: string;
}

interface ServiceConfig {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  port?: number;
  source: string;
}

interface OrchestrationDetection {
  tool: string;
  configPath: string;
  startCommand: string;
  stopCommand: string;
}

interface RunningService {
  name: string;
  pid: number;
  config: ServiceConfig;
  startedAt: string;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

export default function App() {
  const [view, setView] = useState<'guide' | 'create' | 'workspaces' | 'settings'>('guide');
  
  // App Config
  const [config, setConfig] = useState<NexusFlowConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configExists, setConfigExists] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [defaultPaths, setDefaultPaths] = useState<{ devDir: string; workspacesDir: string } | null>(null);

  // Repos & Tools
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [aiAssistants, setAiAssistants] = useState<DetectedAI[]>([]);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  // Wizard State
  const [activeStep, setActiveStep] = useState(0);
  const [branchName, setBranchName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<RepoInfo[]>([]);
  const [selectedAI, setSelectedAI] = useState<string[]>([]);
  const [selectedEditor, setSelectedEditor] = useState<DetectedEditor | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] = useState<{ path: string } | null>(null);

  // Resumption Commands State
  const [testCommand, setTestCommand] = useState('npm run test');
  const [mockCommand, setMockCommand] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [resumingWs, setResumingWs] = useState<string | null>(null);

  // Suggest defaults based on selected repos
  useEffect(() => {
    if (selectedRepos.length === 0) return;
    const isDotNet = selectedRepos.some(r => r.name.toLowerCase().includes('dotnet') || r.name.toLowerCase().includes('csharp') || r.name.toLowerCase().includes('microsoft'));
    const isPython = selectedRepos.some(r => r.name.toLowerCase().includes('django') || r.name.toLowerCase().includes('flask') || r.name.toLowerCase().includes('fastapi') || r.name.toLowerCase().includes('python'));
    
    if (isDotNet) {
      setTestCommand('dotnet test');
    } else if (isPython) {
      setTestCommand('pytest');
    } else {
      setTestCommand('npm run test');
    }
  }, [selectedRepos]);

  // Workspaces List
  const [workspaces, setWorkspaces] = useState<Feature[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // Active Workspace Services / Orchestration Details
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [orchTools, setOrchTools] = useState<OrchestrationDetection[]>([]);
  const [runningServices, setRunningServices] = useState<RunningService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [subTab, setSubTab] = useState<'services' | 'changes' | 'sessions'>('sessions');
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [gitChanges, setGitChanges] = useState<any[]>([]);
  const [gitChangesLoading, setGitChangesLoading] = useState(false);

  // Log Viewer
  const [selectedLogService, setSelectedLogService] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Initial loads
  useEffect(() => {
    fetchConfig();
    fetchAIAssistants();
    fetchEditors();
    fetchWorkspaces();
  }, []);

  // Poll logs and services status when active workspace is open
  useEffect(() => {
    let interval: any = null;
    if (activeWsId) {
      fetchWorkspaceServices(activeWsId);
      interval = setInterval(() => {
        fetchWorkspaceServices(activeWsId, true);
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeWsId]);

  // Load git changes when tab switches to 'changes' or active workspace changes
  useEffect(() => {
    if (activeWsId && subTab === 'changes') {
      fetchGitChanges(activeWsId);
    }
  }, [activeWsId, subTab]);

  // Load sessions when active workspace changes or subTab switches to 'sessions'
  useEffect(() => {
    if (activeWsId && subTab === 'sessions') {
      fetchWorkspaceSessions(activeWsId);
    }
  }, [activeWsId, subTab]);


  // Poll logs for active service logs
  useEffect(() => {
    let interval: any = null;
    if (activeWsId && selectedLogService) {
      fetchLogs(activeWsId, selectedLogService);
      interval = setInterval(() => {
        fetchLogs(activeWsId, selectedLogService);
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeWsId, selectedLogService]);

  // Scroll to bottom of logs when log content changes
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [serviceLogs]);

  // ─── API Fetches ────────────────────────────────────────────────────────

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      const data = await res.json();
      setConfig(data.config);
      setConfigExists(data.exists);
      
      if (data.exists && data.config.devDir) {
        fetchRepos();
      } else {
        setDefaultPaths({
          devDir: data.config.devDir || '',
          workspacesDir: data.config.workspacesDir || '',
        });
        setConfig({
          version: '1.0.0',
          devDir: '',
          workspacesDir: '',
          defaultAssistant: null,
          scanDepth: 2,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setConfigLoading(false);
    }
  };

  const saveAppConfig = async (newConfig: NexusFlowConfig) => {
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        setSaveStatus('success');
        setConfig(newConfig);
        setConfigExists(true);
        fetchRepos();
        fetchWorkspaces();
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const fetchRepos = async () => {
    setReposLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/repos`);
      const data = await res.json();
      setRepos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setReposLoading(false);
    }
  };

  const fetchAIAssistants = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai-detect`);
      const data = await res.json();
      setAiAssistants(data);
      setSelectedAI(data.filter((ai: DetectedAI) => ai.detected).map((ai: DetectedAI) => ai.name));
    } catch (e) {
      console.error(e);
    }
  };

  const fetchEditors = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/editor-detect`);
      const data = await res.json();
      setEditors(data);
      const defaultEditor = data.find((ed: DetectedEditor) => ed.detected);
      if (defaultEditor) setSelectedEditor(defaultEditor);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWorkspaces = async () => {
    setWorkspacesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspaces`);
      const data = await res.json();
      setWorkspaces(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setWorkspacesLoading(false);
    }
  };

  const fetchWorkspaceServices = async (wsId: string, silent = false) => {
    if (!silent) setServicesLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/services`);
      const data = await res.json();
      setServices(data.services || []);
      setOrchTools(data.orchestrationTools || []);
      setRunningServices(data.runningState || []);
      
      if (data.services.length > 0 && !selectedLogService) {
        setSelectedLogService(data.services[0].name);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setServicesLoading(false);
    }
  };

  const fetchLogs = async (wsId: string, serviceName: string) => {
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/services/logs/${serviceName}`);
      const data = await res.json();
      setServiceLogs(data.logs || '');
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGitChanges = async (wsId: string) => {
    setGitChangesLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/changes`);
      const data = await res.json();
      setGitChanges(data.changes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setGitChangesLoading(false);
    }
  };

  const fetchWorkspaceSessions = async (wsId: string) => {
    setSessionsLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/sessions`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSessionsLoading(false);
    }
  };

  const fetchSessionTranscript = async (assistant: string, sessionId: string) => {
    setTranscriptLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/session/${assistant}/${sessionId}/transcript`);
      const data = await res.json();
      setTranscript(data.messages || []);
    } catch (e) {
      console.error(e);
    } finally {
      setTranscriptLoading(false);
    }
  };


  // ─── Actions ────────────────────────────────────────────────────────────

  const handleToggleRepo = (repo: RepoInfo) => {
    if (selectedRepos.some((r) => r.path === repo.path)) {
      setSelectedRepos(selectedRepos.filter((r) => r.path !== repo.path));
    } else {
      setSelectedRepos([...selectedRepos, repo]);
    }
  };

  const handleToggleAI = (aiName: string) => {
    if (selectedAI.includes(aiName)) {
      setSelectedAI(selectedAI.filter((x) => x !== aiName));
    } else {
      setSelectedAI([...selectedAI, aiName]);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!branchName || selectedRepos.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchName,
          description,
          repos: selectedRepos,
          assistants: selectedAI,
          resumption: {
            testCommand,
            mockCommand: mockCommand || undefined,
            startCommand: startCommand || undefined,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCreatedWorkspace({ path: data.workspacePath });
        setActiveStep(3);
        fetchWorkspaces();

        if (selectedEditor) {
          await fetch(`${API_BASE}/api/open-editor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspacePath: data.workspacePath,
              command: selectedEditor.command,
            }),
          });
        }
      } else {
        alert(`Error: ${data.error || 'Failed to create workspace'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network error when creating workspace.');
    } finally {
      setCreating(false);
    }
  };

  const handleStartServices = async (wsId: string) => {
    try {
      const encodedId = encodeURIComponent(wsId);
      await fetch(`${API_BASE}/api/workspace/${encodedId}/services/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services }),
      });
      fetchWorkspaceServices(wsId, true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStopServices = async (wsId: string) => {
    try {
      const encodedId = encodeURIComponent(wsId);
      await fetch(`${API_BASE}/api/workspace/${encodedId}/services/stop`, {
        method: 'POST',
      });
      fetchWorkspaceServices(wsId, true);
      setServiceLogs('Services stopped.');
    } catch (e) {
      console.error(e);
    }
  };

  const handleResumeSession = async (ws: Feature, sessionId?: string, assistant?: string) => {
    setResumingWs(ws.branchName);
    try {
      const encodedId = encodeURIComponent(ws.branchName);
      const editor = editors.find((e) => e.detected) || editors[0];
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: editor?.command,
          sessionId,
          assistant,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        navigator.clipboard.writeText(data.resumeCommand);
        alert(`Session Resumed!\n\n1. Editor launched.\n2. Command "${data.resumeCommand}" copied to clipboard! Paste it into your terminal inside the workspace to continue.`);
        setActiveWsId(ws.branchName);
      } else {
        alert(`Error: ${data.error || 'Failed to resume session'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network error when resuming session.');
    } finally {
      setResumingWs(null);
    }
  };

  const handleOpenInEditor = async (workspacePath: string) => {
    const editor = editors.find((e) => e.detected) || editors[0];
    if (!editor) {
      alert('No detected editors available.');
      return;
    }
    try {
      await fetch(`${API_BASE}/api/open-editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          command: editor.command,
        }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyPrompt = (ws: Feature) => {
    const repoNames = ws.repos.map((r) => r.split(/[\\/]/).pop()).join(', ');
    const prompt = `You are an AI assistant helping with feature development.
We are working in a multi-repository workspace.

Workspace Metadata:
- Feature Branch: ${ws.branchName}
- Purpose & Context: ${ws.description}
- Mapped Repositories: ${repoNames}

Core Instructions:
1. Always inspect and update "session.md" (session state handover memo) and "plan.md" (tasks checklist) at the workspace root as you progress.
2. Read "WORKSPACE.md" at the root for a detailed index of repository relationships, tech stacks, and listening ports.
3. Follow all project-specific rules in "CLAUDE.md", ".cursorrules", or "AGENTS.md" in sub-repositories.
`;
    navigator.clipboard.writeText(prompt);
    alert('Universal AI briefing prompt copied to clipboard!');
  };

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  if (!configExists && config) {
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
  }

  return (
    <div className="flex min-h-screen bg-[#060813] bg-gradient-to-br from-[#0c0f24] via-[#060813] to-[#04050a] text-gray-100 font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#090d1a]/85 border-r border-gray-800/80 flex flex-col p-6 shrink-0 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-9 h-9 bg-gradient-to-tr from-cyan-400 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25 text-lg">
            N
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
            NexusFlow
          </span>
        </div>
        <nav className="flex-1">
          <ul className="flex flex-col gap-2">
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold transition-all cursor-pointer border ${
                  view === 'guide'
                    ? 'text-white bg-indigo-500/10 border-indigo-500/20 shadow-sm'
                    : 'text-gray-400 border-transparent hover:text-white hover:bg-gray-800/40'
                }`}
                onClick={() => {
                  setView('guide');
                }}
              >
                <Sparkles size={18} className="text-indigo-400" />
                Getting Started
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold transition-all cursor-pointer border ${
                  view === 'create'
                    ? 'text-white bg-indigo-500/10 border-indigo-500/20 shadow-sm'
                    : 'text-gray-400 border-transparent hover:text-white hover:bg-gray-800/40'
                }`}
                onClick={() => {
                  setView('create');
                  setActiveStep(0);
                  setCreatedWorkspace(null);
                  setBranchName('');
                  setDescription('');
                  setSelectedRepos([]);
                }}
              >
                <PlusCircle size={18} className="text-indigo-400" />
                New Workspace
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold transition-all cursor-pointer border ${
                  view === 'workspaces'
                    ? 'text-white bg-indigo-500/10 border-indigo-500/20 shadow-sm'
                    : 'text-gray-400 border-transparent hover:text-white hover:bg-gray-800/40'
                }`}
                onClick={() => {
                  setView('workspaces');
                  fetchWorkspaces();
                }}
              >
                <FolderGit2 size={18} className="text-indigo-400" />
                Active Workspaces
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-semibold transition-all cursor-pointer border ${
                  view === 'settings'
                    ? 'text-white bg-indigo-500/10 border-indigo-500/20 shadow-sm'
                    : 'text-gray-400 border-transparent hover:text-white hover:bg-gray-800/40'
                }`}
                onClick={() => {
                  setView('settings');
                  fetchConfig();
                }}
              >
                <SettingsIcon size={18} className="text-indigo-400" />
                Settings
              </button>
            </li>
          </ul>
        </nav>
        <div className="pt-6 border-t border-gray-800/60 text-[11px] text-gray-500 text-center">
          NexusFlow Engine v0.1.0
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-10 overflow-y-auto max-w-7xl w-full mx-auto">
        {configLoading ? (
          <div className="flex flex-col items-center justify-center py-40 gap-4 text-gray-400">
            <RefreshCw className="animate-spin text-indigo-400" size={32} />
            <span className="text-sm font-medium">Loading config settings...</span>
          </div>
        ) : (
          <>
            {/* View 0: Getting Started Guide */}
            {view === 'guide' && config && (
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
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-6 shadow-xl backdrop-blur-sm space-y-6">
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
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
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
                        onClick={() => setView('create')}
                      >
                        <PlusCircle size={14} /> Create a Workspace
                      </button>
                      <button
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                        onClick={() => setView('settings')}
                      >
                        <SettingsIcon size={14} className="text-gray-500" /> Modify Settings
                      </button>
                    </div>
                  </div>
                </div>

                {/* Compare dashboard at the bottom */}
                <div className="bg-[#111827]/20 border border-gray-800/80 rounded-xl p-6 shadow-md">
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
            )}

            {/* View 1: Wizard Workspace Builder */}
            {view === 'create' && (
              <div className="max-w-4xl mx-auto">
                <header className="mb-10">
                  <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">New Feature Workspace</h1>
                  <p className="text-sm text-gray-400">
                    Set up unified git worktrees, scan tech stacks, and write contextual configurations for your AI assistant.
                  </p>
                </header>

                {/* Progress Circle bar */}
                <div className="flex justify-between items-center max-w-xl mx-auto mb-14 relative px-4">
                  <div className="absolute top-4 left-6 right-6 h-[2px] bg-gray-800 -z-10"></div>
                  <div
                    className="absolute top-4 left-6 h-[2px] bg-gradient-to-r from-cyan-400 to-indigo-500 -z-10 transition-all duration-300"
                    style={{ width: `${(activeStep / 3) * 92}%` }}
                  ></div>
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      activeStep > 0 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 0 ? 'border-indigo-500 bg-[#0b0f19] text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      {activeStep > 0 ? <Check size={14} /> : '1'}
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 0 ? 'text-white' : 'text-gray-500'}`}>Details</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      activeStep > 1 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 1 ? 'border-indigo-500 bg-[#0b0f19] text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      {activeStep > 1 ? <Check size={14} /> : '2'}
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 1 ? 'text-white' : 'text-gray-500'}`}>Repos</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      activeStep > 2 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 2 ? 'border-indigo-500 bg-[#0b0f19] text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      {activeStep > 2 ? <Check size={14} /> : '3'}
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 2 ? 'text-white' : 'text-gray-500'}`}>Assistant</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      activeStep === 3 ? 'border-emerald-500 bg-[#0b0f19] text-emerald-400 shadow-lg shadow-emerald-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      4
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 3 ? 'text-emerald-400' : 'text-gray-500'}`}>Complete</span>
                  </div>
                </div>

                {/* Step 0: Name & Description */}
                {activeStep === 0 && (
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
                    <div className="mb-6">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feature Branch Name</label>
                      <input
                        type="text"
                        className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
                        placeholder="e.g., feature/oauth-authentication-flow"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                      />
                    </div>
                    <div className="mb-8">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Feature Purpose & Context</label>
                      <textarea
                        className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm min-h-[140px] resize-y shadow-inner"
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
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
                    <div className="flex justify-between items-center mb-6">
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Select Repositories</label>
                      <div className="relative w-64">
                        <Search size={14} className="absolute left-3 top-3 text-gray-500" />
                        <input
                          type="text"
                          className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg pl-9 pr-4 py-2 text-white placeholder-gray-600 transition-all outline-none text-xs"
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
                              className={`bg-[#111827]/60 border rounded-xl p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-800/20 hover:border-gray-700 transition-all ${
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
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
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
                              className={`bg-[#111827]/60 border rounded-xl p-4 flex flex-col gap-3 cursor-pointer hover:border-gray-700 transition-all ${
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
                              className={`bg-[#111827]/60 border rounded-xl p-4 flex flex-col cursor-pointer hover:border-gray-700 transition-all ${
                                isSelected ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                              }`}
                              onClick={() => setSelectedEditor(ed)}
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
                          className={`bg-[#111827]/60 border rounded-xl p-4 flex flex-col cursor-pointer hover:border-gray-700 transition-all ${
                            selectedEditor === null ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800/80'
                          }`}
                          onClick={() => setSelectedEditor(null)}
                        >
                          <span className="text-sm font-bold text-white">None</span>
                          <span className="text-[9px] mt-2 w-max px-2 py-0.5 rounded font-semibold uppercase bg-gray-800 text-gray-500">
                            Skip opening
                          </span>
                        </div>
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
                  </div>
                )}

                {/* Step 3: Success Screen */}
                {activeStep === 3 && createdWorkspace && (
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-10 text-center shadow-xl backdrop-blur-sm">
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
                          setView('workspaces');
                          fetchWorkspaces();
                          setActiveWsId(branchName);
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
            )}

            {/* View 2: Active Workspaces Panel */}
            {view === 'workspaces' && (
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
                    <p className="text-xs text-gray-500 max-w-sm mt-1">
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
                                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-md shadow-emerald-600/10 disabled:opacity-40 disabled:cursor-not-allowed"
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
                            </div>
                          </div>

                          <p className="text-xs text-gray-400 bg-gray-950/40 border-l-2 border-indigo-500 rounded-r-lg px-4 py-3 mb-4 font-medium italic">
                            {ws.description}
                          </p>

                          <div className="flex flex-wrap gap-2 mb-4">
                            {ws.repos.map((repoPath) => (
                              <span key={repoPath} className="text-[10px] px-2.5 py-1 bg-gray-900 border border-gray-800 text-gray-300 rounded-md font-semibold">
                                {repoPath.split(/[\\/]/).pop()}
                              </span>
                            ))}
                          </div>

                          {/* Expansion: Process management console */}
                          {isExpanded && (
                            <div className="mt-6 pt-6 border-t border-gray-800/80">
                              
                              {/* Telemetry Dashboard Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                {/* Telemetry 1: CPU */}
                                <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
                                  <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
                                    <span>Simulated CPU Load</span>
                                    <span className={runningServices.length > 0 ? "text-emerald-400" : "text-gray-500"}>{runningServices.length > 0 ? '4.8%' : '0%'}</span>
                                  </div>
                                  <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2 overflow-hidden">
                                    <div 
                                      className={`h-1.5 rounded-full transition-all duration-500 ${runningServices.length > 0 ? "bg-gradient-to-r from-emerald-500 to-teal-400 animate-pulse" : "bg-gray-700"}`}
                                      style={{ width: runningServices.length > 0 ? '48%' : '0%' }}
                                    ></div>
                                  </div>
                                  <span className="text-[10px] text-gray-500">Fluctuating active worker processes</span>
                                </div>

                                {/* Telemetry 2: Memory */}
                                <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
                                  <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
                                    <span>Simulated Memory Allocation</span>
                                    <span className={runningServices.length > 0 ? "text-cyan-400" : "text-gray-500"}>{runningServices.length > 0 ? '192 MB' : '0 MB'}</span>
                                  </div>
                                  <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2 overflow-hidden">
                                    <div 
                                      className={`h-1.5 rounded-full transition-all duration-500 ${runningServices.length > 0 ? "bg-gradient-to-r from-cyan-500 to-indigo-400" : "bg-gray-700"}`}
                                      style={{ width: runningServices.length > 0 ? '65%' : '0%' }}
                                    ></div>
                                  </div>
                                  <span className="text-[10px] text-gray-500">Working set size for spawned servers</span>
                                </div>

                                {/* Telemetry 3: Environment Health */}
                                <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
                                  <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
                                    <span>Active Workspace Status</span>
                                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider ${runningServices.length > 0 ? "text-emerald-400" : "text-gray-500"}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${runningServices.length > 0 ? "bg-emerald-500 animate-ping" : "bg-gray-600"}`}></span>
                                      {runningServices.length > 0 ? "Online" : "Idle"}
                                    </span>
                                  </div>
                                  <div className="text-xs text-white font-medium truncate">
                                    {runningServices.length > 0 ? `${runningServices.length} processes active` : "All processes offline"}
                                  </div>
                                  <span className="text-[10px] text-gray-500">Service state mapping</span>
                                </div>
                              </div>

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
                              </div>

                              {subTab === 'sessions' && (
                                sessionsLoading ? (
                                  <div className="flex justify-center py-10">
                                    <RefreshCw className="animate-spin text-indigo-400" size={20} />
                                  </div>
                                ) : sessions.length === 0 ? (
                                  <div className="text-center py-10 bg-gray-950/20 border border-gray-800/60 rounded-xl p-6">
                                    <MessageSquareCode size={36} className="text-gray-650 mx-auto mb-3" />
                                    <h4 className="text-sm font-bold text-gray-400 mb-1">No Past AI Sessions Found</h4>
                                    <p className="text-xs text-gray-505 max-w-md mx-auto leading-relaxed">
                                      Start a conversation with your AI assistant (e.g. running <code>claude</code>, <code>agy</code>, <code>codex</code>, or <code>copilot</code> inside this directory) to track session history here.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="space-y-3 mb-6">
                                    {sessions.map((sess) => (
                                      <div key={sess.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-950/20 border border-gray-800/60 rounded-xl p-4 hover:border-gray-700/80 transition-all">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2.5 mb-1.5">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                              sess.assistant === 'antigravity' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
                                              sess.assistant === 'claude' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                              sess.assistant === 'codex' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                              'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                            }`}>
                                              {sess.assistant === 'antigravity' ? 'Antigravity' :
                                               sess.assistant === 'claude' ? 'Claude Code' :
                                               sess.assistant === 'codex' ? 'OpenAI Codex' : 'GitHub Copilot'}
                                            </span>
                                            <span className="text-[10px] text-gray-500">
                                              Updated: {new Date(sess.updatedAt).toLocaleString()}
                                            </span>
                                            <span className="text-[10px] text-gray-500">•</span>
                                            <span className="text-[10px] text-gray-550 font-medium">
                                              {sess.messageCount} messages
                                            </span>
                                          </div>
                                          <h4 className="text-xs font-semibold text-white truncate pr-4" title={sess.title}>
                                            {sess.title}
                                          </h4>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <button
                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                            onClick={() => {
                                              setActiveSession(sess);
                                              setTranscript([]);
                                              fetchSessionTranscript(sess.assistant, sess.id);
                                            }}
                                          >
                                            <MessageSquare size={13} /> View Chat Log
                                          </button>
                                          <button
                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                            onClick={() => handleResumeSession(ws, sess.id, sess.assistant)}
                                          >
                                            <Play size={11} /> Resume
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )
                              )}

                              {subTab === 'services' && (
                                servicesLoading ? (
                                  <div className="flex justify-center py-10">
                                    <RefreshCw className="animate-spin text-indigo-400" size={20} />
                                  </div>
                                ) : (
                                  <div>
                                    {orchTools.length > 0 && (
                                      <div className="flex items-center gap-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-4 text-xs text-indigo-300">
                                        <AlertTriangle size={16} className="text-indigo-400 shrink-0" />
                                        <div>
                                          <strong>Orchestration manifest detected:</strong> {orchTools.map((t) => t.tool).join(', ')}. You can start them inside sub-repos.
                                        </div>
                                      </div>
                                    )}

                                    <div className="flex flex-col gap-2 mb-4">
                                      {services.map((svc) => {
                                        const isRunning = runningServices.some((rs) => rs.name === svc.name);
                                        return (
                                          <div key={svc.name} className="flex justify-between items-center bg-gray-950/20 border border-gray-800/60 rounded-xl px-4 py-3 text-xs">
                                            <div className="flex items-center gap-3">
                                              <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-gray-700'}`}></span>
                                              <div>
                                                <span className="font-bold text-white">{svc.name}</span>
                                                <span className="text-[10px] text-gray-500 ml-3">
                                                  {svc.command} {svc.args.join(' ')} {svc.port ? `• port ${svc.port}` : ''}
                                                </span>
                                              </div>
                                            </div>
                                            <span className="text-[9px] px-2 py-0.5 rounded bg-gray-800 text-gray-500 font-bold uppercase">{svc.source}</span>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    <div className="flex gap-2 mb-6">
                                      <button
                                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10 hover:-translate-y-0.5 active:translate-y-0"
                                        onClick={() => handleStartServices(ws.branchName)}
                                        disabled={runningServices.length > 0}
                                      >
                                        <Play size={14} /> Start All Services
                                      </button>
                                      <button
                                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-rose-600/10 hover:-translate-y-0.5 active:translate-y-0"
                                        onClick={() => handleStopServices(ws.branchName)}
                                        disabled={runningServices.length === 0}
                                      >
                                        <Square size={14} /> Stop All
                                      </button>
                                    </div>

                                    {/* Interactive Console Screen */}
                                    {services.length > 0 && (
                                      <div className="border border-gray-800/80 rounded-xl overflow-hidden shadow-2xl bg-gray-950/60">
                                        {/* Terminal Window Header */}
                                        <div className="flex items-center justify-between bg-gray-900/80 px-4 py-3 border-b border-gray-800/60">
                                          <div className="flex items-center gap-2">
                                            <div className="flex gap-1.5">
                                              <span className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/30"></span>
                                              <span className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/30"></span>
                                              <span className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/30"></span>
                                            </div>
                                            <span className="text-[11px] font-mono text-gray-400 font-semibold ml-2">nexusflow-terminal: {selectedLogService}</span>
                                          </div>
                                          <div className="flex gap-1 bg-gray-950/40 p-1 rounded-lg border border-gray-800/60">
                                            {services.map((svc) => (
                                              <button
                                                key={svc.name}
                                                className={`px-3 py-1 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer ${
                                                  selectedLogService === svc.name
                                                    ? 'bg-slate-800 text-white shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-300'
                                                }`}
                                                onClick={() => setSelectedLogService(svc.name)}
                                              >
                                                {svc.name}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        
                                        {/* Terminal Screen Body */}
                                        <div className="bg-[#030408] p-5 font-mono text-[11px] text-cyan-400/90 h-80 overflow-y-auto whitespace-pre-wrap shadow-inner relative scrollbar-thin scrollbar-thumb-gray-800">
                                          <div className="absolute top-3 right-3 text-[9px] bg-slate-900/60 border border-gray-800 text-cyan-500/60 px-2 py-0.5 rounded font-mono select-none uppercase tracking-wider">
                                            LIVE LOGS
                                          </div>
                                          {serviceLogs}
                                          <div ref={logsEndRef}></div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              )}

                              {/* Active Changes View */}
                              {subTab === 'changes' && (
                                <div>
                                  <header className="flex justify-between items-center mb-4">
                                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                      <FolderGit2 size={16} className="text-cyan-400" /> Active Workspace Git Diffs
                                    </h4>
                                    <button
                                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-[10px] font-semibold transition-all cursor-pointer text-gray-300"
                                      onClick={() => fetchGitChanges(ws.branchName)}
                                      disabled={gitChangesLoading}
                                    >
                                      <RefreshCw size={11} className={gitChangesLoading ? 'animate-spin text-indigo-400' : ''} /> Refresh Changes
                                    </button>
                                  </header>

                                  {gitChangesLoading ? (
                                    <div className="flex justify-center py-10">
                                      <RefreshCw className="animate-spin text-indigo-400" size={20} />
                                    </div>
                                  ) : (
                                    <div className="space-y-4">
                                      {gitChanges.every(repo => repo.files.length === 0) ? (
                                        <div className="flex flex-col items-center justify-center py-12 bg-gray-950/20 border border-gray-800/40 rounded-xl text-center">
                                          <Check size={28} className="text-emerald-500 mb-2" />
                                          <h5 className="text-xs font-bold text-white">No Uncommitted Changes</h5>
                                          <p className="text-[10px] text-gray-500 mt-0.5">Workspace is completely synced with Git feature branches.</p>
                                        </div>
                                      ) : (
                                        gitChanges.map((repo) => {
                                          if (repo.files.length === 0) return null;
                                          return (
                                            <div key={repo.repoName} className="bg-gray-950/20 border border-gray-800/60 rounded-xl p-4">
                                              <div className="flex justify-between items-center mb-3">
                                                <h5 className="text-xs font-bold text-white font-mono">{repo.repoName}</h5>
                                                <span className="text-[9px] text-gray-500 font-mono truncate max-w-[280px]">{repo.repoPath}</span>
                                              </div>
                                              <div className="space-y-1.5">
                                                {repo.files.map((fileInfo: any) => (
                                                  <div key={fileInfo.file} className="flex justify-between items-center bg-[#090d1a]/40 px-3 py-2 rounded-lg border border-gray-800/30 text-xs">
                                                    <span className="font-mono text-gray-300 text-[11px] truncate max-w-[320px]">{fileInfo.file}</span>
                                                    <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                                                      fileInfo.type === 'added' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                      fileInfo.type === 'deleted' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                                      'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                    }`}>
                                                      {fileInfo.type}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* View 3: Settings View */}
            {view === 'settings' && config && (
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mb-6">
                  <div className="flex flex-col">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Development Directory</label>
                    <input
                      type="text"
                      className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
                      value={config.devDir}
                      onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
                    />
                    <span className="text-[10px] text-gray-500 mt-1">Directory where your git projects are scanned.</span>
                  </div>

                  <div className="flex flex-col">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Workspaces Directory</label>
                    <input
                      type="text"
                      className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
                      value={config.workspacesDir}
                      onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
                    />
                    <span className="text-[10px] text-gray-500 mt-1">Directory where unified worktree environments are spun up.</span>
                  </div>

                  <div className="flex flex-col">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Repo Search Depth</label>
                    <input
                      type="number"
                      className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
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
                      className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
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
                </div>

                <div className="flex justify-end">
                  <button
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
                    onClick={() => saveAppConfig(config)}
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Transcript Modal Overlay */}
      {activeSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-[#0b0f19] border border-gray-800 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/40">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    activeSession.assistant === 'antigravity' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
                    activeSession.assistant === 'claude' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                    activeSession.assistant === 'codex' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                    'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  }`}>
                    {activeSession.assistant === 'antigravity' ? 'Antigravity' :
                     activeSession.assistant === 'claude' ? 'Claude Code' :
                     activeSession.assistant === 'codex' ? 'OpenAI Codex' : 'GitHub Copilot'}
                  </span>
                  <span className="text-[10px] text-gray-500">Session: {activeSession.id}</span>
                </div>
                <h3 className="text-sm font-bold text-white truncate max-w-xl" title={activeSession.title}>
                  {activeSession.title}
                </h3>
              </div>
              <button
                className="text-gray-400 hover:text-white p-2 hover:bg-gray-800/80 rounded-lg transition-colors cursor-pointer"
                onClick={() => setActiveSession(null)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body / Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-950/10">
              {transcriptLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <RefreshCw className="animate-spin text-indigo-400" size={24} />
                  <span className="text-xs text-gray-500 font-medium">Loading conversation history...</span>
                </div>
              ) : transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-500">
                  No messages found in this transcript.
                </div>
              ) : (
                transcript.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className="text-[10px] text-gray-500 mb-1 px-1">
                      {msg.role === 'user' ? 'Developer' : activeSession.assistant === 'antigravity' ? 'Antigravity' : activeSession.assistant === 'claude' ? 'Claude' : activeSession.assistant === 'codex' ? 'Codex' : 'Copilot'}
                      {msg.timestamp && ` • ${new Date(msg.timestamp).toLocaleTimeString()}`}
                    </div>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-indigo-650 text-white rounded-tr-none shadow-md border border-indigo-500/10'
                        : 'bg-gray-900 border border-gray-800 text-gray-200 rounded-tl-none shadow-sm font-sans'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/40 flex justify-between items-center">
              <span className="text-[11px] text-gray-550">
                Resuming will copy the shell command and open your code editor.
              </span>
              <div className="flex gap-2">
                <button
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 rounded-lg text-xs font-bold text-white transition-all cursor-pointer"
                  onClick={() => {
                    const cmd = activeSession.assistant === 'antigravity' ? `agy --conversation ${activeSession.id}` :
                                activeSession.assistant === 'claude' ? `claude --resume ${activeSession.id}` :
                                activeSession.assistant === 'codex' ? `codex resume ${activeSession.id}` :
                                `copilot --resume ${activeSession.id}`;
                    navigator.clipboard.writeText(cmd);
                    alert(`Copied run command to clipboard:\n\n${cmd}`);
                  }}
                >
                  <Copy size={13} /> Copy Resume Command
                </button>
                <button
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                  onClick={() => {
                    const ws = workspaces.find(w => w.branchName === activeSession.workspacePath.split(/[\\/]/).pop());
                    handleResumeSession(ws || workspaces[0], activeSession.id, activeSession.assistant);
                    setActiveSession(null);
                  }}
                >
                  <Play size={12} /> Resume Conversation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
