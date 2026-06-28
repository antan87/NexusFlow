import { useState, useEffect, useRef } from 'react';
import {
  PlusCircle,
  FolderGit2,
  Settings as SettingsIcon,
  Terminal,
  Play,
  Check,
  AlertTriangle,
  AlertCircle,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Search,
  Sparkles,
  Copy,
  X,
  Cpu,
} from 'lucide-react';
import './App.css';
import { WorkspaceList } from './features/workspace/WorkspaceList.js';


// Types matched with src/types.ts
interface LocalLlmConfig {
  enabled: boolean;
  provider: 'ollama' | 'openai-compatible';
  endpoint: string;
  model: string;
}

interface NexusFlowConfig {
  version: string;
  devDir: string;
  workspacesDir: string;
  defaultAssistant: string | null;
  defaultEditor?: string | null;
  scanDepth: number;
  localLlm?: LocalLlmConfig;
  packContextXml?: boolean;
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

const API_BASE = (import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).Neutralino)) ? 'http://localhost:3000' : '';
const isVsCode = new URLSearchParams(window.location.search).get('env') === 'vscode';
let toastIdCounter = 0;

export default function App() {
  const [view, setView] = useState<'guide' | 'create' | 'workspaces' | 'settings'>('guide');

  // Toast State
  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
    duration?: number;
  }
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info', duration = 5000) => {
    const id = `toast-${++toastIdCounter}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  };
  
  // App Config
  const [config, setConfig] = useState<NexusFlowConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configExists, setConfigExists] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);

  // Update Check State
  const [updateStatus, setUpdateStatus] = useState<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    downloadUrl?: string | null;
    releaseNotes?: string;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('0.1.5');
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
  const [localLlmEnabled, setLocalLlmEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] = useState<{ path: string } | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [creationSteps, setCreationSteps] = useState<any[]>([
    { id: 'worktrees', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
    { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
    { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
    { id: 'pack', name: 'Pack Codebase Context', status: 'pending', message: 'Waiting...' },
  ]);

  const [toolsStatus, setToolsStatus] = useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [updatingToolId, setUpdatingToolId] = useState<string | null>(null);

  // App Autoupdate State
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateStep, setUpdateStep] = useState<'idle' | 'downloading' | 'applying' | 'error'>('idle');

  // Workflow Strategy State
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('plan-implement-review');
  const [customTeamworkInstructions, setCustomTeamworkInstructions] = useState<string>('');

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
  const [subTab, setSubTab] = useState<'overview' | 'services' | 'changes' | 'sessions' | 'knowledge' | 'plan'>('overview');
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [gitChanges, setGitChanges] = useState<any[]>([]);
  const [gitChangesLoading, setGitChangesLoading] = useState(false);
  const [knowledgeContent, setKnowledgeContent] = useState<string>('');
  const [knowledgeLoading, setKnowledgeLoading] = useState<boolean>(false);
  const [isEditingKnowledge, setIsEditingKnowledge] = useState<boolean>(false);
  const [editedKnowledge, setEditedKnowledge] = useState<string>('');
  const [saveKnowledgeLoading, setSaveKnowledgeLoading] = useState<boolean>(false);
  const [planContent, setPlanContent] = useState<string>('');
  const [planLoading, setPlanLoading] = useState<boolean>(false);
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [syncResults, setSyncResults] = useState<any[] | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [showCommitModal, setShowCommitModal] = useState<boolean>(false);
  const [commitLoading, setCommitLoading] = useState<boolean>(false);
  const [commitResults, setCommitResults] = useState<any[] | null>(null);
  const [deleteWsLoading, setDeleteWsLoading] = useState<string | null>(null);
  const [addRepoLoading, setAddRepoLoading] = useState<boolean>(false);


  // Log Viewer
  const [selectedLogService, setSelectedLogService] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Local LLM states
  const [recommendation, setRecommendation] = useState<{ totalRamGb: number; gpuName: string; recommendedModel: string } | null>(null);
  const [testStatus, setTestStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [testingLlm, setTestingLlm] = useState(false);

  const isSettingsFormValid = (() => {
    if (!config) return false;
    if (!config.devDir || config.devDir.trim() === '' || !config.workspacesDir || config.workspacesDir.trim() === '') return false;
    if (config.localLlm?.enabled) {
      const endpoint = config.localLlm.endpoint?.trim() || '';
      if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        return false;
      }
    }
    return true;
  })();

  // Effects moved below helper functions to resolve lexical declaration order

  // ─── API Fetches ────────────────────────────────────────────────────────

  const fetchUpdateStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/update-status`);
      if (res.ok) {
        const data = await res.json();
        setUpdateStatus(data);
        if (data.currentVersion) {
          setAppVersion(data.currentVersion);
        }
      }
    } catch (e) {
      console.error('Failed to fetch update status:', e);
    }
  };

  const fetchToolsStatus = async (force = false) => {
    setToolsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/updates/tools${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setToolsStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch tools status:', e);
    } finally {
      setToolsLoading(false);
    }
  };

  const handleUpdateTool = async (toolId: string) => {
    setUpdatingToolId(toolId);
    try {
      const res = await fetch(`${API_BASE}/api/updates/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`${toolId} updated successfully!\n\nOutput:\n${data.output}`, 'success');
        fetchToolsStatus(true);
        fetchUpdateStatus();
      } else {
        showToast(`Error: ${data.error || 'Failed to update tool'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network error when updating tool.', 'error');
    } finally {
      setUpdatingToolId(null);
    }
  };

  const handleAutoUpdate = async () => {
    if (!updateStatus || !updateStatus.downloadUrl) {
      showToast('No update download URL found.', 'error');
      return;
    }

    setUpdatingApp(true);
    setUpdateStep('downloading');

    try {
      // 1. Download the installer
      const downloadRes = await fetch(`${API_BASE}/api/updates/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadUrl: updateStatus.downloadUrl }),
      });
      const downloadData = await downloadRes.json();

      if (!downloadRes.ok || !downloadData.success) {
        throw new Error(downloadData.error || 'Failed to download installer binary');
      }

      // 2. Apply the installer
      setUpdateStep('applying');
      const applyRes = await fetch(`${API_BASE}/api/updates/apply`, {
        method: 'POST',
      });
      const applyData = await applyRes.json();

      if (!applyRes.ok || !applyData.success) {
        throw new Error(applyData.error || 'Failed to trigger application update');
      }

      showToast('Update downloaded! App is restarting...', 'success');

      // 3. Exit Neutralino client window to unlock files on disk
      if (typeof window !== 'undefined' && (window as any).Neutralino) {
        setTimeout(() => {
          (window as any).Neutralino.app.exit();
        }, 800);
      }
    } catch (err: any) {
      console.error('Update failed:', err);
      setUpdateStep('error');
      showToast(`Update Failed: ${err.message || 'Unknown error'}`, 'error');
      setUpdatingApp(false);
    }
  };

  const fetchLlmRecommendation = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/local-llm/recommend`);
      if (res.ok) {
        const data = await res.json();
        setRecommendation(data);
      }
    } catch (e) {
      console.error('Error fetching LLM recommendation:', e);
    }
  };

  const testLlmConnection = async () => {
    if (!config?.localLlm) return;
    setTestingLlm(true);
    setTestStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/local-llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.localLlm),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus({ success: true, message: data.message });
      } else {
        setTestStatus({ success: false, message: data.error || 'Connection failed.' });
      }
    } catch (e: any) {
      setTestStatus({ success: false, message: e.message || 'Network error.' });
    } finally {
      setTestingLlm(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      const data = await res.json();
      setConfig(data.config);
      setConfigExists(data.exists);
      setLocalLlmEnabled(data.config?.localLlm?.enabled || false);
      
      fetchEditors(data.config?.defaultEditor);
      
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
        setLocalLlmEnabled(newConfig.localLlm?.enabled || false);
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

  const fetchEditors = async (savedDefaultEditorCode?: string | null) => {
    try {
      const res = await fetch(`${API_BASE}/api/editor-detect`);
      const data = await res.json();
      setEditors(data);
      
      let initialEditor = null;
      if (savedDefaultEditorCode) {
        initialEditor = data.find((ed: DetectedEditor) => ed.command === savedDefaultEditorCode);
      }
      if (!initialEditor) {
        initialEditor = data.find((ed: DetectedEditor) => ed.detected);
      }
      if (initialEditor) setSelectedEditor(initialEditor);
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

  const fetchWorkflowTemplates = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/templates`);
      if (res.ok) {
        const data = await res.json();
        setWorkflowTemplates(data.templates || []);
        
        // Default to plan-implement-review template
        const pir = data.templates?.find((t: any) => t.id === 'plan-implement-review');
        if (pir) {
          setCustomTeamworkInstructions(pir.content);
        }
      }
    } catch (e) {
      console.error('Failed to fetch workflow templates:', e);
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


  const fetchKnowledge = async (wsId: string) => {
    setKnowledgeLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/knowledge`);
      const data = await res.json();
      setKnowledgeContent(data.content || '');
      setEditedKnowledge(data.content || '');
    } catch (e) {
      console.error(e);
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const handleSaveKnowledge = async (wsId: string) => {
    setSaveKnowledgeLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/knowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedKnowledge }),
      });
      if (res.ok) {
        setKnowledgeContent(editedKnowledge);
        setIsEditingKnowledge(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaveKnowledgeLoading(false);
    }
  };

  const fetchPlan = async (wsId: string) => {
    setPlanLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/plan`);
      const data = await res.json();
      setPlanContent(data.content || '');
    } catch (e) {
      console.error(e);
    } finally {
      setPlanLoading(false);
    }
  };


  const handleSyncAll = async (wsId: string) => {
    setSyncLoading(true);
    setSyncResults(null);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/sync`, { method: 'POST' });
      const data = await res.json();
      setSyncResults(data.results || []);
      fetchGitChanges(wsId);
    } catch (e) {
      console.error(e);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleCommitAll = async (wsId: string) => {
    if (!commitMessage.trim()) return;
    setCommitLoading(true);
    setCommitResults(null);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage }),
      });
      const data = await res.json();
      setCommitResults(data.results || []);
      setCommitMessage('');
      setShowCommitModal(false);
      fetchGitChanges(wsId);
    } catch (e) {
      console.error(e);
    } finally {
      setCommitLoading(false);
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
    setCreationError(null);

    // Reset steps to pending
    setCreationSteps([
      { id: 'worktrees', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
      { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
      { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
      { id: 'pack', name: 'Pack Codebase Context', status: 'pending', message: 'Waiting...' },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchName,
          description,
          repos: selectedRepos,
          assistants: selectedAI,
          localLlmEnabled,
          teamworkInstructions: customTeamworkInstructions || undefined,
          resumption: {
            testCommand,
            mockCommand: mockCommand || undefined,
            startCommand: startCommand || undefined,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const jobId = data.jobId;

        // Establish EventSource SSE connection
        const eventSource = new EventSource(`${API_BASE}/api/workspace/create-stream/${encodeURIComponent(jobId)}`);

        eventSource.addEventListener('progress', (e) => {
          try {
            const job = JSON.parse(e.data);
            if (job.steps) {
              setCreationSteps(job.steps);
            }
            if (job.status === 'completed') {
              eventSource.close();
              setCreatedWorkspace({ path: job.workspacePath });
              setActiveStep(3);
              setCreating(false);
              fetchWorkspaces();

              if (selectedEditor) {
                if (isVsCode) {
                  window.parent.postMessage({ type: 'openWorkspaceFolder', workspacePath: job.workspacePath }, '*');
                } else {
                  fetch(`${API_BASE}/api/open-editor`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      workspacePath: job.workspacePath,
                      command: selectedEditor.command,
                    }),
                  }).catch(console.error);
                }
              }
            } else if (job.status === 'failed') {
              eventSource.close();
              setCreating(false);
              setCreationError(job.error || 'Failed to create workspace');
            }
          } catch (err) {
            console.error('Failed to parse SSE data:', err);
          }
        });

        eventSource.onerror = (err) => {
          console.error('SSE Error:', err);
          eventSource.close();
          setCreating(false);
          setCreationError('Connection lost while building workspace.');
        };
      } else {
        setCreating(false);
        setCreationError(data.error || 'Failed to initialize workspace build');
      }
    } catch (e) {
      console.error(e);
      setCreating(false);
      setCreationError('Network error when creating workspace.');
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
        if (isVsCode) {
          window.parent.postMessage({
            type: 'executeTerminalCommand',
            command: data.resumeCommand,
            cwd: ws.workspacePath
          }, '*');
          setActiveWsId(ws.branchName);
        } else {
          navigator.clipboard.writeText(data.resumeCommand);
          showToast(`Session Resumed!\n\n1. Editor launched.\n2. Command "${data.resumeCommand}" copied to clipboard! Paste it into your terminal inside the workspace to continue.`, 'success');
          setActiveWsId(ws.branchName);
        }
      } else {
        showToast(`Error: ${data.error || 'Failed to resume session'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network error when resuming session.', 'error');
    } finally {
      setResumingWs(null);
    }
  };

  const handleOpenInEditor = async (workspacePath: string) => {
    if (isVsCode) {
      window.parent.postMessage({ type: 'openWorkspaceFolder', workspacePath }, '*');
      return;
    }
    if (config?.defaultEditor === 'none') {
      showToast('Your preferred editor is set to "None" (skip opening). You can change this in Settings.', 'info');
      return;
    }
    let editor = null;
    if (config?.defaultEditor) {
      editor = editors.find((e) => e.command === config.defaultEditor);
    }
    if (!editor) {
      editor = editors.find((e) => e.detected) || editors[0];
    }
    if (!editor) {
      showToast('No detected editors available.', 'error');
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

  const executeTerminal = (command: string) => {
    if (!activeWsId) return;
    const ws = workspaces.find(w => w.branchName === activeWsId);
    if (ws) {
      window.parent.postMessage({
        type: 'executeTerminalCommand',
        command,
        cwd: ws.workspacePath
      }, '*');
    }
  };



  // Initial loads
  useEffect(() => {
    fetchConfig();
    fetchAIAssistants();
    fetchWorkspaces();
    fetchUpdateStatus();
    fetchWorkflowTemplates();

    // Support auto-loading workspace from VS Code or URL params
    const queryParams = new URLSearchParams(window.location.search);
    const queryWsId = queryParams.get('workspaceId');
    if (queryWsId) {
      setActiveWsId(queryWsId);
      setView('workspaces');
    }
  }, []);

  // Load tool updates status and LLM recommendations when settings view is open
  useEffect(() => {
    if (view === 'settings') {
      fetchToolsStatus();
      fetchLlmRecommendation();
    }
  }, [view]);

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

  // Load knowledge when subTab switches to 'knowledge' or active workspace changes
  useEffect(() => {
    if (activeWsId && subTab === 'knowledge') {
      fetchKnowledge(activeWsId);
    }
  }, [activeWsId, subTab]);

  // Load plan when subTab switches to 'plan' or active workspace changes
  useEffect(() => {
    if (activeWsId && subTab === 'plan') {
      fetchPlan(activeWsId);
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
    showToast('Universal AI briefing prompt copied to clipboard!', 'success');
  };

  const handleDeleteWorkspace = async (wsName: string) => {
    if (!window.confirm(`Are you sure you want to delete the workspace "${wsName}"?\nThis will force remove all git worktrees inside it and delete all files in the folder.`)) {
      return;
    }
    setDeleteWsLoading(wsName);
    try {
      const encodedId = encodeURIComponent(wsName);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (activeWsId === wsName) {
          setActiveWsId(null);
        }
        await fetchWorkspaces();
        showToast(`Workspace ${wsName} successfully deleted.`, 'success');
      } else {
        showToast(`Failed to delete workspace: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network error while deleting workspace.', 'error');
    } finally {
      setDeleteWsLoading(null);
    }
  };

  const handleAddRepo = async (wsName: string, repoPath: string) => {
    setAddRepoLoading(true);
    try {
      const encodedId = encodeURIComponent(wsName);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/repo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchWorkspaces();
        if (activeWsId === wsName) {
          fetchWorkspaceServices(wsName, true);
          fetchGitChanges(wsName);
          fetchWorkspaceSessions(wsName);
        }
        showToast('Repository successfully added. Configurations and Repomix packing updated.', 'success');
      } else {
        showToast(`Failed to add repository: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network error while adding repository.', 'error');
    } finally {
      setAddRepoLoading(false);
    }
  };

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  if (!configExists && config) {
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
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="onboardingPackContextXml"
                      className="w-4 h-4 rounded border-slate-800 bg-slate-950/60 text-indigo-650 focus:ring-indigo-500/50 cursor-pointer"
                      checked={config.packContextXml || false}
                      onChange={(e) => setConfig({ ...config, packContextXml: e.target.checked })}
                    />
                    <label htmlFor="onboardingPackContextXml" className="text-xs font-semibold text-slate-200 cursor-pointer select-none">
                      Pack Codebase Context with Repomix (XML)
                    </label>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1.5 block leading-normal">
                    Aggregates all repository files into a single token-efficient XML file (<code>nexusflow-context.xml</code>) at the workspace root, giving AI assistants immediate access to the full codebase state.
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

  if (isVsCode) {
    return (
      <div className="flex flex-col h-screen w-full bg-[#060813] text-[#d1d5db] font-mono text-[11px] overflow-hidden select-none border-t border-gray-800">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#0b0f19] border-b border-gray-800 shrink-0 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-indigo-400">NEXUSFLOW_SHELL</span>
            <span className="text-gray-700">|</span>
            <span className="text-gray-300">ws: {activeWsId || 'none'}</span>
          </div>
          <div className="flex items-center gap-2">
            {activeWsId && (
              <button
                onClick={() => {
                  setActiveWsId(null);
                  setSelectedLogService(null);
                  setServiceLogs('');
                }}
                className="text-indigo-400 hover:text-indigo-350 hover:underline transition-colors cursor-pointer bg-transparent border-none p-0 outline-none"
              >
                [Change WS]
              </button>
            )}
            <span className="text-[10px] text-gray-500">v{appVersion}</span>
          </div>
        </div>

        {!activeWsId ? (
          /* CLI Workspace Selection Menu */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
            <div className="text-indigo-400 font-bold mb-4 text-[12px] uppercase">
              === Select Active Workspace ===
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {workspaces.map((ws) => (
                <button
                  key={ws.branchName}
                  onClick={() => {
                    setActiveWsId(ws.branchName);
                    fetchWorkspaceServices(ws.branchName);
                  }}
                  className="w-full text-left p-2.5 bg-gray-950 border border-gray-800 hover:border-indigo-500 rounded hover:bg-indigo-500/5 text-gray-300 hover:text-white transition-all text-[11px] cursor-pointer"
                >
                  &gt; {ws.branchName}
                </button>
              ))}
              {workspaces.length === 0 && (
                <div className="text-gray-550 italic">No workspaces found. Initialize one via the CLI.</div>
              )}
            </div>
          </div>
        ) : (
          /* Active Workspace Panel */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Top Config / Control Panel */}
            <div className="p-3 border-b border-gray-800 shrink-0 bg-gray-950/30">
              {/* Service Control Buttons */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => handleStartServices(activeWsId)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 font-bold transition-all cursor-pointer text-[10px]"
                >
                  <Play size={10} /> [START SERVICES]
                </button>
                <button
                  onClick={() => handleStopServices(activeWsId)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 font-bold transition-all cursor-pointer text-[10px]"
                >
                  <X size={10} /> [STOP SERVICES]
                </button>
              </div>

              {/* Service List */}
              <div className="mb-3">
                <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1 px-1">
                  Background Services ({runningServices.filter(rs => rs.pid > 0).length}/{services.length})
                </div>
                {services.length === 0 ? (
                  <div className="text-gray-600 italic px-1 text-[10px]">No services detected in workspace.</div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-1">
                    {services.map((service) => {
                      const isRunning = runningServices.some((rs) => rs.name === service.name && rs.pid > 0);
                      const isSelected = selectedLogService === service.name;
                      return (
                        <div
                          key={service.name}
                          onClick={() => setSelectedLogService(service.name)}
                          className={`flex items-center justify-between p-1.5 border rounded cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-950/40 border-indigo-500/50 text-white'
                              : 'bg-gray-950/20 border-gray-800 hover:border-gray-700 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}></span>
                            <span className="font-bold truncate">{service.name}</span>
                          </div>
                          <span className="text-[10px] font-mono shrink-0">
                            {isRunning ? (
                              <span className="text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20 text-[8px] font-bold uppercase">on</span>
                            ) : (
                              <span className="text-gray-500 bg-gray-900 px-1 py-0.2 rounded border border-gray-800 text-[8px] font-bold uppercase">off</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* MCP Status Check */}
              <div className="mb-3 border-t border-gray-800 pt-2.5">
                <div className="text-[10px] text-gray-400 font-bold uppercase mb-1 px-1">
                  Active Local MCP Tools
                </div>
                <div className="flex flex-col gap-1 px-1 text-[10px] text-gray-450 font-mono">
                  <div className="flex justify-between">
                    <span>• search_workspace</span>
                    <span className="text-indigo-400 font-bold">READY</span>
                  </div>
                  <div className="flex justify-between">
                    <span>• get_service_logs</span>
                    <span className="text-indigo-400 font-bold">READY</span>
                  </div>
                  <div className="flex justify-between">
                    <span>• delegate_to_local_agent</span>
                    <span className={config?.localLlm?.enabled ? "text-indigo-400 font-bold" : "text-gray-600 font-bold"}>
                      {config?.localLlm?.enabled ? 'READY' : 'DISABLED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Interactive CLI Buttons */}
              <div className="border-t border-gray-800 pt-2.5">
                <div className="text-[10px] text-gray-400 font-bold uppercase mb-1.5 px-1">
                  Terminal Commands (Click to Run)
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => executeTerminal('nexusflow sync')}
                    className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                  >
                    $ nexusflow sync
                  </button>
                  <button
                    onClick={() => executeTerminal('nexusflow diff')}
                    className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                  >
                    $ nexusflow diff
                  </button>
                  <button
                    onClick={() => executeTerminal('nexusflow handoff')}
                    className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                  >
                    $ nexusflow handoff
                  </button>
                  <button
                    onClick={() => executeTerminal('nexusflow status')}
                    className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                  >
                    $ nexusflow status
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Log Pane */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#04060d]">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#090d1a] border-b border-gray-800/80 shrink-0 text-[9px] text-gray-400 uppercase tracking-wider font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                  <span>log_stream: {selectedLogService || 'none'}</span>
                </div>
                <button
                  onClick={() => {
                    if (activeWsId && selectedLogService) {
                      fetchLogs(activeWsId, selectedLogService);
                    }
                  }}
                  className="text-gray-500 hover:text-white font-mono hover:underline cursor-pointer bg-transparent border-none p-0 outline-none"
                >
                  [refresh]
                </button>
              </div>
              <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap select-text selection:bg-indigo-500/30 text-gray-300">
                {serviceLogs.trim() ? (
                  serviceLogs
                ) : (
                  <span className="text-gray-600 italic font-mono">(no logs recorded yet)</span>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#05070c] text-slate-300 font-mono crt-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-[#05070c] border-r border-slate-900 flex flex-col p-6 shrink-0 relative z-10 neon-border">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-9 h-9 bg-gradient-to-tr from-cyan-500 to-violet-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-500/10 text-lg select-none">
            NF
          </div>
          <div>
            <span className="text-sm font-bold tracking-wider text-white">
              NexusFlow
            </span>
            <span className="block text-[8px] text-cyan-400 font-semibold tracking-widest uppercase mt-0.5">COMMAND_CENTER</span>
          </div>
        </div>
        <nav className="flex-1">
          <ul className="flex flex-col gap-2">
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-xs font-bold transition-all cursor-pointer border relative overflow-hidden group ${
                  view === 'guide'
                    ? 'text-cyan-400 bg-cyan-950/30 border-cyan-900/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-900/40'
                }`}
                onClick={() => {
                  setView('guide');
                }}
              >
                <Sparkles size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                Getting Started
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-xs font-bold transition-all cursor-pointer border relative overflow-hidden group ${
                  view === 'create'
                    ? 'text-cyan-400 bg-cyan-950/30 border-cyan-900/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-900/40'
                }`}
                onClick={() => {
                  setView('create');
                  setActiveStep(0);
                  setCreatedWorkspace(null);
                  setBranchName('');
                  setDescription('');
                  setSelectedRepos([]);
                  setLocalLlmEnabled(config?.localLlm?.enabled || false);
                }}
              >
                <PlusCircle size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                New Workspace
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-xs font-bold transition-all cursor-pointer border relative overflow-hidden group ${
                  view === 'workspaces'
                    ? 'text-cyan-400 bg-cyan-950/30 border-cyan-900/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-900/40'
                }`}
                onClick={() => {
                  setView('workspaces');
                  fetchWorkspaces();
                }}
              >
                <FolderGit2 size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                Active Workspaces
              </button>
            </li>
            <li>
              <button
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-xs font-bold transition-all cursor-pointer border relative overflow-hidden group ${
                  view === 'settings'
                    ? 'text-cyan-400 bg-cyan-950/30 border-cyan-900/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-900/40'
                }`}
                onClick={() => {
                  setView('settings');
                  fetchConfig();
                }}
              >
                <SettingsIcon size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                Settings
              </button>
            </li>
          </ul>
        </nav>
        <div className="pt-6 border-t border-slate-900 text-[10px] text-slate-500 text-center tracking-wider font-semibold uppercase">
          SYSTEM_UI: ONLINE v{appVersion}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto max-w-7xl w-full mx-auto">
        {configLoading ? (
          <div className="flex flex-col items-center justify-center py-40 gap-4 text-gray-400">
            <RefreshCw className="animate-spin text-indigo-400" size={32} />
            <span className="text-sm font-medium">Loading config settings...</span>
          </div>
        ) : (
          <>
            {/* Update Notification Banner */}
            {updateStatus && updateStatus.updateAvailable && (
              <div className="mb-6 p-4 bg-gradient-to-r from-amber-500/10 to-orange-600/10 border border-amber-500/30 rounded-xl shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                    {updatingApp ? (
                      <RefreshCw size={20} className="animate-spin text-amber-400" />
                    ) : (
                      <Sparkles size={20} />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-300">
                      {updatingApp ? (
                        updateStep === 'downloading' ? 'Downloading Update...' : 'Applying Update...'
                      ) : (
                        'A new version of NexusFlow is available!'
                      )}
                    </h4>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {updatingApp ? (
                        updateStep === 'downloading' ? 'Fetching installer from GitHub Releases...' : 'Closing app and launching silent installer setup...'
                      ) : (
                        `Upgrade from v${updateStatus.currentVersion} to v${updateStatus.latestVersion} to get the latest features and bug fixes.`
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {typeof window !== 'undefined' && (window as any).Neutralino && updateStatus.downloadUrl && (
                    <button
                      onClick={handleAutoUpdate}
                      disabled={updatingApp}
                      className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-xs rounded-lg transition-all shadow-md disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                    >
                      {updatingApp ? 'Installing...' : 'Install Automatically'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('npm install -g @mrpatronz/nexusflow');
                      showToast('Update command copied to clipboard!', 'success');
                    }}
                    disabled={updatingApp}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-[#060813] font-bold text-xs rounded-lg transition-all shadow-md shadow-amber-500/10 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    Copy Update Command
                  </button>
                </div>
              </div>
            )}

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

                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                        4
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">Repomix Packing (Optional)</h3>
                        <p className="text-xs text-gray-400 mt-1">
                          If enabled, NexusFlow aggregates the entire multi-repo codebase using <code>Repomix</code> into a token-efficient XML file <code>nexusflow-context.xml</code>, giving AI immediate access to the full codebase state. You can toggle this setting in Settings.
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
                <div className="flex justify-between items-center max-w-2xl mx-auto mb-14 relative px-4">
                  <div className="absolute top-4 left-6 right-6 h-[2px] bg-gray-800 -z-10"></div>
                  <div
                    className="absolute top-4 left-6 h-[2px] bg-gradient-to-r from-cyan-400 to-indigo-500 -z-10 transition-all duration-300"
                    style={{ width: `${(activeStep / 4) * 95}%` }}
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
                      activeStep > 3 ? 'bg-emerald-500 border-emerald-500 text-white' : activeStep === 3 ? 'border-indigo-500 bg-[#0b0f19] text-white shadow-lg shadow-indigo-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      {activeStep > 3 ? <Check size={14} /> : '4'}
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 3 ? 'text-white' : 'text-gray-500'}`}>Strategy</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all ${
                      activeStep === 4 ? 'border-emerald-500 bg-[#0b0f19] text-emerald-400 shadow-lg shadow-emerald-500/20' : 'border-gray-800 bg-gray-900 text-gray-500'
                    }`}>
                      5
                    </div>
                    <span className={`text-[11px] font-semibold tracking-wide uppercase ${activeStep === 4 ? 'text-emerald-400' : 'text-gray-500'}`}>Complete</span>
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
                              className={`bg-[#111827]/60 border rounded-xl p-4 flex flex-col cursor-pointer hover:border-gray-700 transition-all ${
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
                  <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm">
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
                          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Team Collaboration Strategy</label>
                          <p className="text-xs text-gray-500 mb-4">
                            Select an agent cooperation pattern. This writes instructions to <code>AGENTS.md</code> directing how the team coordinates.
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            {workflowTemplates.map((template) => {
                              const isSelected = selectedWorkflowId === template.id;
                              return (
                                <div
                                  key={template.id}
                                  className={`bg-[#111827]/60 border rounded-xl p-4 flex flex-col gap-2 cursor-pointer hover:border-gray-700 transition-all ${
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
                            className="w-full bg-[#111827] border border-gray-850 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-605 transition-all outline-none text-xs font-mono min-h-[220px] resize-y shadow-inner leading-relaxed"
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
              <WorkspaceList
                workspacesLoading={workspacesLoading}
                workspaces={workspaces}
                activeWsId={activeWsId}
                setActiveWsId={setActiveWsId}
                resumingWs={resumingWs}
                handleResumeSession={handleResumeSession}
                handleCopyPrompt={handleCopyPrompt}
                handleOpenInEditor={handleOpenInEditor}
                fetchWorkspaces={fetchWorkspaces}
                aiAssistants={aiAssistants}
                repos={repos}
                deleteWsLoading={deleteWsLoading}
                addRepoLoading={addRepoLoading}
                handleDeleteWorkspace={handleDeleteWorkspace}
                handleAddRepo={handleAddRepo}
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
                knowledgeContent={knowledgeContent}
                knowledgeLoading={knowledgeLoading}
                isEditingKnowledge={isEditingKnowledge}
                editedKnowledge={editedKnowledge}
                saveKnowledgeLoading={saveKnowledgeLoading}
                setEditedKnowledge={setEditedKnowledge}
                setIsEditingKnowledge={setIsEditingKnowledge}
                handleSaveKnowledge={handleSaveKnowledge}
                planContent={planContent}
                planLoading={planLoading}
                sessions={sessions}
                sessionsLoading={sessionsLoading}
                activeSession={activeSession}
                transcript={transcript}
                transcriptLoading={transcriptLoading}
                setActiveSession={setActiveSession}
                setTranscript={setTranscript}
                fetchSessionTranscript={fetchSessionTranscript}
                subTab={subTab}
                setSubTab={setSubTab}
              />
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

                  <div className="flex flex-col">
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Default Editor</label>
                    <select
                      className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
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
                    <h3 className="text-sm font-bold text-white mb-2">Codebase Context Settings</h3>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="packContextXml"
                        className="w-4 h-4 rounded border-gray-800 bg-[#111827] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        checked={config.packContextXml || false}
                        onChange={(e) => setConfig({ ...config, packContextXml: e.target.checked })}
                      />
                      <label htmlFor="packContextXml" className="text-xs font-semibold text-white cursor-pointer select-none">
                        Pack Codebase Context with Repomix (XML)
                      </label>
                    </div>
                    <span className="text-[10px] text-gray-500 mt-1">
                      Aggregates files of all repositories in a workspace into a single token-efficient XML file (<code>nexusflow-context.xml</code>) at the workspace root, giving AI assistants immediate access to the full codebase state.
                    </span>
                  </div>
                </div>

                {/* Local AI Co-Processor Settings */}
                <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mb-6 mt-6">
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
                      className="w-4 h-4 rounded border-gray-800 bg-[#111827] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
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
                            className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white transition-all outline-none text-sm shadow-inner cursor-pointer"
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
                            className={`w-full bg-[#111827] border focus:ring-1 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner ${
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
                            className="w-full bg-[#111827] border border-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-sm shadow-inner"
                            value={config.localLlm.model}
                            onChange={(e) => setConfig({
                              ...config,
                              localLlm: { ...config.localLlm!, model: e.target.value }
                            })}
                          />
                          <span className="text-[10px] text-gray-500 mt-1">Exact name of the model registered on the server (e.g., <code>qwen2.5-coder:1.5b</code>).</span>
                        </div>
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

                <div className="flex justify-end">
                  <button
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    disabled={!isSettingsFormValid}
                    onClick={() => saveAppConfig(config)}
                  >
                    Save Configuration
                  </button>
                </div>

                {/* Toolchain Updates Section */}
                <div className="bg-[#111827]/40 border border-gray-800/80 rounded-xl p-8 shadow-xl backdrop-blur-sm mt-6">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">AI Toolchain Updates</h3>
                      <p className="text-xs text-gray-555">Monitor and update CLI packages and assistants in your workflow.</p>
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
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400">
                      <RefreshCw className="animate-spin text-indigo-400" size={24} />
                      <span className="text-xs">Fetching registry version details...</span>
                    </div>
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
                            <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                              <span>Installed version: <code className="text-gray-300 font-mono text-[10px]">{tool.currentVersion}</code></span>
                              {tool.installed && (
                                <span>Latest: <code className="text-gray-300 font-mono text-[10px]">{tool.latestVersion}</code></span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1 font-mono">{tool.updateCmd}</p>
                          </div>
                          
                          <div className="shrink-0 flex items-center gap-3">
                            {tool.updateAvailable ? (
                              <button
                                onClick={() => handleUpdateTool(tool.id)}
                                disabled={updatingToolId !== null}
                                className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-[#060813] font-bold text-xs rounded-lg transition-all shadow-md shadow-amber-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                              >
                                {updatingToolId === tool.id ? (
                                  <>
                                    <RefreshCw className="animate-spin" size={12} /> Updating...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles size={12} /> Update Tool
                                  </>
                                )}
                              </button>
                            ) : tool.installed ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 bg-emerald-500/5 px-2.5 py-1.5 rounded-lg border border-emerald-500/10">
                                  <Check size={12} /> Up to Date
                                </span>
                                <button
                                  onClick={() => handleUpdateTool(tool.id)}
                                  disabled={updatingToolId !== null}
                                  className="px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-750 text-gray-300 font-bold text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                                >
                                  {updatingToolId === tool.id ? (
                                    <>
                                      <RefreshCw className="animate-spin" size={12} /> Reinstalling...
                                    </>
                                  ) : (
                                    'Reinstall'
                                  )}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleUpdateTool(tool.id)}
                                disabled={updatingToolId !== null}
                                className="px-3.5 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white font-bold text-xs rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {updatingToolId === tool.id ? (
                                  <>
                                    <RefreshCw className="animate-spin" size={12} /> Installing...
                                  </>
                                ) : (
                                  'Install CLI'
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
                    showToast(`Copied run command to clipboard:\n\n${cmd}`, 'success');
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

      {/* Toast Notifications Container */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none max-w-md w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start justify-between gap-3 px-4 py-3 rounded-xl border shadow-2xl transition-all duration-300 animate-slide-in ${
              toast.type === 'success'
                ? 'bg-[#062c1b]/95 border-emerald-800/80 text-emerald-100'
                : toast.type === 'error'
                ? 'bg-[#2c0e0e]/95 border-red-900/80 text-red-100'
                : 'bg-[#131926]/95 border-slate-800/80 text-slate-100'
            }`}
          >
            <div className="flex items-start gap-2.5 text-xs font-semibold flex-1">
              {toast.type === 'success' && <Check className="text-emerald-400 shrink-0 mt-0.5" size={16} />}
              {toast.type === 'error' && <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />}
              {toast.type === 'info' && <Sparkles className="text-indigo-400 shrink-0 mt-0.5" size={16} />}
              <span className="whitespace-pre-line text-left leading-relaxed">{toast.message}</span>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
