import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import './App.css';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppSidebar } from './app/AppSidebar.js';
import { ToastStack, type Toast } from './app/ToastStack.js';
import { VsCodeShell } from './app/VsCodeShell.js';
import { GettingStartedPage } from './features/guide/GettingStartedPage.js';
import { OnboardingScreen } from './features/onboarding/OnboardingScreen.js';
import { TranscriptDialog } from './features/sessions/TranscriptDialog.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { WizardPage } from './pages/WizardPage.js';
import { StrategiesPage } from './pages/StrategiesPage.js';
import { WorkspacesPage } from './pages/WorkspacesPage.js';
import { API_BASE } from './lib/apiBase.js';


// Types matched with src/types.ts
interface LocalLlmConfig {
  enabled: boolean;
  provider: 'ollama' | 'openai-compatible';
  endpoint: string;
  model: string;
  apiKey?: string;
}

interface NexusFlowConfig {
  version: string;
  devDir: string;
  workspacesDir: string;
  defaultAssistant: string | null;
  defaultEditor?: string | null;
  scanDepth: number;
  localLlm?: LocalLlmConfig;
  storageProvider?: string;
  adapterConfig?: Record<string, Record<string, any>>;
  plugins?: string[];
}

interface AdapterConfigField {
  key: string;
  label: string;
  type: 'string' | 'boolean' | 'number' | 'path';
  required?: boolean;
  default?: any;
  description?: string;
}

interface StorageAdapterMeta {
  name: string;
  displayName: string;
  description: string;
  configFields: AdapterConfigField[];
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
  // Set in the wizard to base a repo's worktree on an existing branch instead
  // of the new feature branch.
  existingBranch?: string;
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

type SyncStatus = 'up-to-date' | 'rebased' | 'conflict' | 'stash-conflict' | 'error';

interface WorkspaceStatus {
  id: string;
  branchName: string;
  changedFiles: number;
  dirtyRepos: number;
  runningServices: number;
  syncStatus: SyncStatus | 'unknown';
  pendingValidation: boolean;
}

const isVsCode = new URLSearchParams(window.location.search).get('env') === 'vscode';
let toastIdCounter = 0;

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();

  // Toast State
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
  const [adapters, setAdapters] = useState<StorageAdapterMeta[]>([]);

  // Update Check State
  const [updateStatus, setUpdateStatus] = useState<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    downloadUrl?: string | null;
    releaseNotes?: string;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('');
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
    { id: 'workspace', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
    { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
    { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
  ]);


  // App Autoupdate State
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateStep, setUpdateStep] = useState<'idle' | 'downloading' | 'applying' | 'error'>('idle');

  // Workflow Strategy State
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('plan-implement-review');
  const [customTeamworkInstructions, setCustomTeamworkInstructions] = useState<string>('');
  const [suggestingWorkflow, setSuggestingWorkflow] = useState(false);
  const [suggestedDifficulty, setSuggestedDifficulty] = useState<'simple' | 'moderate' | 'complex' | null>(null);
  const [suggestedRationale, setSuggestedRationale] = useState('');

  // Workflow Strategy Management State
  const [selectedMgtTemplateId, setSelectedMgtTemplateId] = useState<string | null>(null);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [mgtTemplateName, setMgtTemplateName] = useState('');
  const [mgtTemplateContent, setMgtTemplateContent] = useState('');
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [selectedInspectAssistant, setSelectedInspectAssistant] = useState<string>('antigravity');
  const [suggestedImprovement, setSuggestedImprovement] = useState<string | null>(null);
  const [mgtAnalysisComment, setMgtAnalysisComment] = useState('');

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
  // At-a-glance status per workspace (keyed by branchName), for the listing overview.
  const [workspaceStatuses, setWorkspaceStatuses] = useState<Record<string, WorkspaceStatus>>({});
  const [statusesLoading, setStatusesLoading] = useState(false);

  // Active Workspace Services / Orchestration Details
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [orchTools, setOrchTools] = useState<OrchestrationDetection[]>([]);
  const [runningServices, setRunningServices] = useState<RunningService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [serviceWorkspaceId, setServiceWorkspaceId] = useState<string | null>(null);
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

  // AI toolchain update states
  const [toolsStatus, setToolsStatus] = useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [updatingToolId, setUpdatingToolId] = useState<string | null>(null);

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

      const isNeutralino = typeof window !== 'undefined' && (window as any).Neutralino;
      showToast(
        isNeutralino
          ? 'Update downloaded! App is restarting...'
          : 'Update downloaded and installer launched. Restart NexusFlow to complete the update.',
        'success'
      );

      // 3. Exit Neutralino client window to unlock files on disk
      if (isNeutralino) {
        setTimeout(() => {
          (window as any).Neutralino.app.exit();
        }, 800);
      } else {
        setUpdateStep('idle');
        setUpdatingApp(false);
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

  const fetchAdapters = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/adapters`);
      const data = await res.json();
      if (data.adapters) {
        setAdapters(data.adapters);
      }
    } catch (e) {
      console.error('Failed to fetch adapters:', e);
    }
  };

  const fetchConfig = async () => {
    fetchAdapters();
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
      const firstHarness = data.find((ai: any) => ai.detected && ai.command);
      if (firstHarness) {
        setSelectedInspectAssistant(firstHarness.name);
      }
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
      // Refresh at-a-glance status alongside the list (independent endpoint).
      void fetchWorkspaceStatuses();
    } catch (e) {
      console.error(e);
    } finally {
      setWorkspacesLoading(false);
    }
  };

  const fetchWorkspaceStatuses = async () => {
    setStatusesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspaces/status`);
      const data = await res.json();
      setWorkspaceStatuses(data && typeof data === 'object' && !Array.isArray(data) ? data : {});
    } catch (e) {
      console.error(e);
    } finally {
      setStatusesLoading(false);
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

  const handleSaveTemplate = async () => {
    if (!mgtTemplateName.trim() || !mgtTemplateContent.trim()) {
      showToast('Name and content are required.', 'error');
      return;
    }
    setSavingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/api/workflows/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedMgtTemplateId,
          name: mgtTemplateName,
          content: mgtTemplateContent,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast('Strategy template saved successfully!', 'success');
        await fetchWorkflowTemplates();
        setSelectedMgtTemplateId(data.template.id);
        setIsEditingTemplate(false);
        setAnalysisResult(null);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save template', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Error saving template', 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this custom strategy template?')) {
      return;
    }
    setDeletingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/api/workflows/templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('Strategy template deleted successfully!', 'success');
        await fetchWorkflowTemplates();
        setSelectedMgtTemplateId(null);
        setAnalysisResult(null);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete template', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Error deleting template', 'error');
    } finally {
      setDeletingTemplate(false);
    }
  };

  const handleAnalyzeTemplate = async (id: string, content: string, assistant: string) => {
    setAnalyzingTemplate(true);
    setAnalysisResult(null);
    setSuggestedImprovement(null);
    try {
      const res = await fetch(`${API_BASE}/api/workflows/templates/${encodeURIComponent(id)}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, assistant, comment: mgtAnalysisComment }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysisResult(data.analysis);
        setSuggestedImprovement(data.suggestedImprovement || null);
        showToast('Strategy analysis completed successfully!', 'success');
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to analyze template using the selected assistant harness.', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Error analyzing template', 'error');
    } finally {
      setAnalyzingTemplate(false);
    }
  };

  const fetchWorkspaceServices = async (wsId: string, silent = false) => {
    if (!silent) setServicesLoading(true);
    try {
      const encodedId = encodeURIComponent(wsId);
      const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/services`);
      const data = await res.json();
      const nextServices = data.services || [];
      setServiceWorkspaceId(wsId);
      setServices(nextServices);
      setOrchTools(data.orchestrationTools || []);
      setRunningServices(data.runningState || []);
      const hasSelectedService = selectedLogService
        ? nextServices.some((service: ServiceConfig) => service.name === selectedLogService)
        : false;
      if (!silent || !hasSelectedService) setServiceLogs('');
      
      setSelectedLogService((current) => {
        if (nextServices.length === 0) return null;
        if (current && nextServices.some((service: ServiceConfig) => service.name === current)) {
          return current;
        }
        return nextServices[0].name;
      });
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

  const handleSuggestWorkflow = async () => {
    if (!description) {
      showToast('Please enter a description for the workspace details first.', 'info');
      return;
    }
    setSuggestingWorkflow(true);
    setSuggestedDifficulty(null);
    setSuggestedRationale('');
    try {
      const res = await fetch(`${API_BASE}/api/workspace/suggest-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          repos: selectedRepos,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuggestedDifficulty(data.difficulty);
        setSuggestedRationale(data.rationale);
        setSelectedWorkflowId(data.suggestedWorkflowId);
        setCustomTeamworkInstructions(data.customInstructions);
        showToast(`Suggested strategy populated successfully: ${data.difficulty.toUpperCase()} difficulty.`, 'success');
      } else {
        showToast(data.error || 'Failed to auto-suggest strategy.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Network error while requesting strategy suggestion.', 'error');
    } finally {
      setSuggestingWorkflow(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!branchName || selectedRepos.length === 0) return;
    setCreating(true);
    setCreationError(null);

    // Reset steps to pending
    setCreationSteps([
      { id: 'workspace', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
      { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
      { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
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
              setActiveStep(4);
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
    let editor: DetectedEditor | null | undefined = null;
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
      navigate(`/workspaces/${encodeURIComponent(queryWsId)}`);
    }
  }, []);

  // Keep workspace selection (and its data-loading effects) in sync with the route.
  useEffect(() => {
    const p = location.pathname;
    if (p.startsWith('/workspaces')) {
      const parts = p.split('/').filter(Boolean); // ['workspaces', id?, tab?]
      setActiveWsId(parts[1] ? decodeURIComponent(parts[1]) : null);
      const tab = parts[2];
      const valid = ['overview', 'sessions', 'services', 'changes', 'knowledge', 'plan'];
      setSubTab((tab && valid.includes(tab) ? tab : 'overview') as typeof subTab);
    }
  }, [location.pathname]);

  const fetchToolsStatus = async (force = false) => {
    setToolsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/updates/tools${force ? '?force=true' : ''}`);
      if (res.ok) {
        setToolsStatus(await res.json());
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

  // Load tool statuses and LLM recommendations when settings view is open
  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      fetchToolsStatus();
      fetchLlmRecommendation();
    }
  }, [location.pathname]);

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

  // Load git changes for the Changes tab and the Overview (per-repo topology panel)
  useEffect(() => {
    if (activeWsId && (subTab === 'changes' || subTab === 'overview')) {
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
    if (activeWsId && serviceWorkspaceId === activeWsId && selectedLogService) {
      fetchLogs(activeWsId, selectedLogService);
      interval = setInterval(() => {
        fetchLogs(activeWsId, selectedLogService);
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeWsId, serviceWorkspaceId, selectedLogService]);

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
1. Always read and append to "nexusflow-knowledge.md" (persistent workspace memory & decisions) as you progress, and follow the phased order in "nexusflow-plan.md".
2. Read "WORKSPACE.md" at the root for a detailed index of repository relationships, tech stacks, and listening ports.
3. Follow all project-specific rules in "CLAUDE.md", ".cursorrules", or "AGENTS.md" in sub-repositories.
`;
    navigator.clipboard.writeText(prompt);
    showToast('AI context prompt copied to clipboard!', 'success');
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
        showToast('Repository successfully added and configurations updated.', 'success');
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

  if (!configExists && config) {
    return (
      <OnboardingScreen
        config={config}
        setConfig={setConfig}
        defaultPaths={defaultPaths}
        adapters={adapters}
        saveAppConfig={saveAppConfig}
      />
    );
  }

  if (isVsCode) {
    return (
      <VsCodeShell
        activeWsId={activeWsId}
        setActiveWsId={setActiveWsId}
        selectedLogService={selectedLogService}
        setSelectedLogService={setSelectedLogService}
        setServiceLogs={setServiceLogs}
        appVersion={appVersion}
        workspaces={workspaces}
        fetchWorkspaceServices={fetchWorkspaceServices}
        config={config}
        services={services}
        runningServices={runningServices}
        handleStartServices={handleStartServices}
        handleStopServices={handleStopServices}
        executeTerminal={executeTerminal}
        fetchLogs={fetchLogs}
        serviceLogs={serviceLogs}
        logsEndRef={logsEndRef}
      />
    );
  }

  const startNewWorkspace = () => {
    setActiveStep(0);
    setCreatedWorkspace(null);
    setBranchName('');
    setDescription('');
    setSelectedRepos([]);
    setLocalLlmEnabled(config?.localLlm?.enabled || false);
    navigate('/create');
  };

  const dashboardPage = config ? (
    <DashboardPage
      workspaces={workspaces}
      workspaceStatuses={workspaceStatuses}
      workspacesLoading={workspacesLoading}
      statusesLoading={statusesLoading}
      onOpenWorkspace={(id) => navigate(`/workspaces/${encodeURIComponent(id)}`)}
      onNewWorkspace={startNewWorkspace}
    />
  ) : null;

  const guidePage = config ? (
    <GettingStartedPage
      config={config}
      onCreateWorkspace={() => navigate('/create')}
      onModifySettings={() => navigate('/settings')}
    />
  ) : null;

  const wizardPage = config ? (
    <WizardPage
      activeStep={activeStep} setActiveStep={setActiveStep} branchName={branchName} setBranchName={setBranchName}
      description={description} setDescription={setDescription} repos={repos} setRepos={setRepos} reposLoading={reposLoading}
      repoSearch={repoSearch} setRepoSearch={setRepoSearch} selectedRepos={selectedRepos} setSelectedRepos={setSelectedRepos} showToast={showToast}
      aiAssistants={aiAssistants} selectedAI={selectedAI} setSelectedAI={setSelectedAI}
      editors={editors} selectedEditor={selectedEditor} setSelectedEditor={setSelectedEditor}
      config={config} setConfig={setConfig} saveAppConfig={saveAppConfig} localLlmEnabled={localLlmEnabled} setLocalLlmEnabled={setLocalLlmEnabled}
      testCommand={testCommand} setTestCommand={setTestCommand} mockCommand={mockCommand} setMockCommand={setMockCommand} startCommand={startCommand} setStartCommand={setStartCommand}
      suggestingWorkflow={suggestingWorkflow} handleSuggestWorkflow={handleSuggestWorkflow} suggestedDifficulty={suggestedDifficulty} suggestedRationale={suggestedRationale}
      workflowTemplates={workflowTemplates} selectedWorkflowId={selectedWorkflowId} setSelectedWorkflowId={setSelectedWorkflowId}
      customTeamworkInstructions={customTeamworkInstructions} setCustomTeamworkInstructions={setCustomTeamworkInstructions}
      creating={creating} handleCreateWorkspace={handleCreateWorkspace} creationSteps={creationSteps} creationError={creationError}
      setCreating={setCreating} setCreationError={setCreationError} createdWorkspace={createdWorkspace} fetchWorkspaces={fetchWorkspaces} handleOpenInEditor={handleOpenInEditor}
    />
  ) : null;

  const workspacesPage = (
    <WorkspacesPage
      workspaces={workspaces}
      workspaceStatuses={workspaceStatuses}
      statusesLoading={statusesLoading}
      workspacesLoading={workspacesLoading}
      fetchWorkspaces={fetchWorkspaces}
      selectedId={activeWsId}
      subTab={subTab}
      onSelect={(id) => navigate(`/workspaces/${encodeURIComponent(id)}`)}
      onSelectTab={(id, tab) => navigate(`/workspaces/${encodeURIComponent(id)}/${tab}`)}
      resumingWs={resumingWs}
      handleResumeSession={handleResumeSession}
      handleCopyPrompt={handleCopyPrompt}
      handleOpenInEditor={handleOpenInEditor}
      handleDeleteWorkspace={handleDeleteWorkspace}
      deleteWsLoading={deleteWsLoading}
      repos={repos}
      addRepoLoading={addRepoLoading}
      handleAddRepo={handleAddRepo}
      sessionProps={{ sessions, sessionsLoading, activeSession, transcript, transcriptLoading, workspaces, setActiveSession, setTranscript, fetchSessionTranscript, handleResumeSession }}
      serviceProps={{ services, runningServices, selectedLogService, serviceLogs, logsEndRef, setSelectedLogService, handleStartServices, handleStopServices, orchTools, servicesLoading }}
      changesProps={{ gitChanges, gitChangesLoading, syncLoading, syncResults, commitMessage, showCommitModal, commitLoading, commitResults, setSyncResults, setCommitResults, setCommitMessage, setShowCommitModal, fetchGitChanges, handleSyncAll, handleCommitAll }}
      knowledgeProps={{ knowledgeContent, knowledgeLoading, isEditingKnowledge, editedKnowledge, saveKnowledgeLoading, setEditedKnowledge, setIsEditingKnowledge, handleSaveKnowledge }}
      planProps={{ planContent, planLoading }}
    />
  );

  const workflowsPage = (
    <StrategiesPage
      workflowTemplates={workflowTemplates} isEditingTemplate={isEditingTemplate} setIsEditingTemplate={setIsEditingTemplate}
      mgtTemplateName={mgtTemplateName} setMgtTemplateName={setMgtTemplateName} mgtTemplateContent={mgtTemplateContent} setMgtTemplateContent={setMgtTemplateContent}
      selectedMgtTemplateId={selectedMgtTemplateId} setSelectedMgtTemplateId={setSelectedMgtTemplateId}
      analysisResult={analysisResult} setAnalysisResult={setAnalysisResult} showToast={showToast}
      handleAnalyzeTemplate={handleAnalyzeTemplate} handleSaveTemplate={handleSaveTemplate} handleDeleteTemplate={handleDeleteTemplate}
      aiAssistants={aiAssistants} analyzingTemplate={analyzingTemplate} mgtAnalysisComment={mgtAnalysisComment} setMgtAnalysisComment={setMgtAnalysisComment}
      suggestedImprovement={suggestedImprovement} setSuggestedImprovement={setSuggestedImprovement} savingTemplate={savingTemplate} deletingTemplate={deletingTemplate}
      selectedInspectAssistant={selectedInspectAssistant} setSelectedInspectAssistant={setSelectedInspectAssistant}
    />
  );

  const settingsPage = config ? (
    <SettingsPage
      config={config} setConfig={setConfig} saveStatus={saveStatus} editors={editors} adapters={adapters}
      saveAppConfig={saveAppConfig} isSettingsFormValid={isSettingsFormValid} recommendation={recommendation}
      testingLlm={testingLlm} testStatus={testStatus} testLlmConnection={testLlmConnection}
      toolsStatus={toolsStatus} toolsLoading={toolsLoading} updatingToolId={updatingToolId}
      fetchToolsStatus={fetchToolsStatus} handleUpdateTool={handleUpdateTool}
    />
  ) : null;

  return (
    <div className="flex min-h-screen bg-base text-content">
      <AppSidebar
        pathname={location.pathname}
        appVersion={appVersion}
        onNavigate={navigate}
        onNewWorkspace={startNewWorkspace}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 sm:p-8">
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

            {/* Offline / Backend Unreachable State */}
            {!config && (
              <div className="flex flex-col items-center justify-center py-40 gap-6">
                <div className="bg-red-500/10 p-6 rounded-full">
                  <AlertTriangle className="text-red-400" size={48} />
                </div>
                <div className="text-center max-w-md">
                  <h2 className="text-2xl font-bold text-white mb-2">Backend Unreachable</h2>
                  <p className="text-sm text-gray-400 mb-6">
                    The NexusFlow GUI could not connect to the local server. Make sure you started the GUI correctly via <code>nexusflow ui</code> or that the backend is running.
                  </p>
                  <button
                    onClick={() => { setConfigLoading(true); fetchConfig(); }}
                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white font-medium text-sm rounded-md transition-colors cursor-pointer inline-flex items-center gap-2"
                  >
                    <RefreshCw size={16} /> Try Again
                  </button>
                </div>
              </div>
            )}

            <Routes>
              <Route path="/" element={dashboardPage} />
              <Route path="/guide" element={guidePage} />
              <Route path="/create" element={wizardPage} />
              <Route path="/new" element={wizardPage} />
              <Route path="/workspaces" element={workspacesPage} />
              <Route path="/workspaces/:workspaceId" element={workspacesPage} />
              <Route path="/workspaces/:workspaceId/:tab" element={workspacesPage} />
              <Route path="/settings" element={settingsPage} />
              <Route path="/workflows" element={workflowsPage} />
              <Route path="/strategies" element={workflowsPage} />
              <Route path="*" element={dashboardPage} />
            </Routes>
          </>
        )}
      </main>

      {activeSession && (
        <TranscriptDialog
          activeSession={activeSession}
          transcript={transcript}
          transcriptLoading={transcriptLoading}
          setActiveSession={setActiveSession}
          workspaces={workspaces}
          handleResumeSession={handleResumeSession}
          showToast={showToast}
        />
      )}

      <ToastStack
        toasts={toasts}
        onDismiss={(toastId) => setToasts((prev) => prev.filter((t) => t.id !== toastId))}
      />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppInner />
    </HashRouter>
  );
}
