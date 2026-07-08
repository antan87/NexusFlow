import { create } from 'zustand';
import type { RepoInfo, DetectedAI, DetectedEditor, NexusFlowConfig, StorageAdapterMeta, Feature, WorkspaceStatus, ServiceConfig, OrchestrationDetection, RunningService, Toast } from '../types.js';

export interface AppState {
  view: 'dashboard' | 'guide' | 'create' | 'workspaces' | 'settings' | 'workflows';
  setView: (value: 'dashboard' | 'guide' | 'create' | 'workspaces' | 'settings' | 'workflows' | ((prev: 'dashboard' | 'guide' | 'create' | 'workspaces' | 'settings' | 'workflows') => 'dashboard' | 'guide' | 'create' | 'workspaces' | 'settings' | 'workflows')) => void;
  toasts: Toast[];
  setToasts: (value: Toast[] | ((prev: Toast[]) => Toast[])) => void;
  config: NexusFlowConfig | null;
  setConfig: (value: NexusFlowConfig | null | ((prev: NexusFlowConfig | null) => NexusFlowConfig | null)) => void;
  configLoading: boolean;
  setConfigLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  configExists: boolean;
  setConfigExists: (value: boolean | ((prev: boolean) => boolean)) => void;
  saveStatus: 'success' | 'error' | null;
  setSaveStatus: (value: 'success' | 'error' | null | ((prev: 'success' | 'error' | null) => 'success' | 'error' | null)) => void;
  adapters: StorageAdapterMeta[];
  setAdapters: (value: StorageAdapterMeta[] | ((prev: StorageAdapterMeta[]) => StorageAdapterMeta[])) => void;
  appVersion: string;
  setAppVersion: (value: string | ((prev: string) => string)) => void;
  defaultPaths: { devDir: string; workspacesDir: string } | null;
  setDefaultPaths: (value: { devDir: string; workspacesDir: string } | null | ((prev: { devDir: string; workspacesDir: string } | null) => { devDir: string; workspacesDir: string } | null)) => void;
  repos: RepoInfo[];
  setRepos: (value: RepoInfo[] | ((prev: RepoInfo[]) => RepoInfo[])) => void;
  reposLoading: boolean;
  setReposLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  repoSearch: string;
  setRepoSearch: (value: string | ((prev: string) => string)) => void;
  aiAssistants: DetectedAI[];
  setAiAssistants: (value: DetectedAI[] | ((prev: DetectedAI[]) => DetectedAI[])) => void;
  editors: DetectedEditor[];
  setEditors: (value: DetectedEditor[] | ((prev: DetectedEditor[]) => DetectedEditor[])) => void;
  activeStep: number;
  setActiveStep: (value: number | ((prev: number) => number)) => void;
  branchName: string;
  setBranchName: (value: string | ((prev: string) => string)) => void;
  description: string;
  setDescription: (value: string | ((prev: string) => string)) => void;
  selectedRepos: RepoInfo[];
  setSelectedRepos: (value: RepoInfo[] | ((prev: RepoInfo[]) => RepoInfo[])) => void;
  selectedAI: string[];
  setSelectedAI: (value: string[] | ((prev: string[]) => string[])) => void;
  selectedEditor: DetectedEditor | null;
  setSelectedEditor: (value: DetectedEditor | null | ((prev: DetectedEditor | null) => DetectedEditor | null)) => void;
  localLlmEnabled: boolean;
  setLocalLlmEnabled: (value: boolean | ((prev: boolean) => boolean)) => void;
  creating: boolean;
  setCreating: (value: boolean | ((prev: boolean) => boolean)) => void;
  createdWorkspace: { path: string } | null;
  setCreatedWorkspace: (value: { path: string } | null | ((prev: { path: string } | null) => { path: string } | null)) => void;
  creationError: string | null;
  setCreationError: (value: string | null | ((prev: string | null) => string | null)) => void;
  updatingApp: boolean;
  setUpdatingApp: (value: boolean | ((prev: boolean) => boolean)) => void;
  updateStep: 'idle' | 'downloading' | 'applying' | 'error';
  setUpdateStep: (value: 'idle' | 'downloading' | 'applying' | 'error' | ((prev: 'idle' | 'downloading' | 'applying' | 'error') => 'idle' | 'downloading' | 'applying' | 'error')) => void;
  workflowTemplates: any[];
  setWorkflowTemplates: (value: any[] | ((prev: any[]) => any[])) => void;
  selectedWorkflowId: string;
  setSelectedWorkflowId: (value: string | ((prev: string) => string)) => void;
  customTeamworkInstructions: string;
  setCustomTeamworkInstructions: (value: string | ((prev: string) => string)) => void;
  suggestingWorkflow: boolean;
  setSuggestingWorkflow: (value: boolean | ((prev: boolean) => boolean)) => void;
  suggestedDifficulty: 'simple' | 'moderate' | 'complex' | null;
  setSuggestedDifficulty: (value: 'simple' | 'moderate' | 'complex' | null | ((prev: 'simple' | 'moderate' | 'complex' | null) => 'simple' | 'moderate' | 'complex' | null)) => void;
  suggestedRationale: string;
  setSuggestedRationale: (value: string | ((prev: string) => string)) => void;
  selectedMgtTemplateId: string | null;
  setSelectedMgtTemplateId: (value: string | null | ((prev: string | null) => string | null)) => void;
  isEditingTemplate: boolean;
  setIsEditingTemplate: (value: boolean | ((prev: boolean) => boolean)) => void;
  mgtTemplateName: string;
  setMgtTemplateName: (value: string | ((prev: string) => string)) => void;
  mgtTemplateContent: string;
  setMgtTemplateContent: (value: string | ((prev: string) => string)) => void;
  analysisResult: string | null;
  setAnalysisResult: (value: string | null | ((prev: string | null) => string | null)) => void;
  analyzingTemplate: boolean;
  setAnalyzingTemplate: (value: boolean | ((prev: boolean) => boolean)) => void;
  savingTemplate: boolean;
  setSavingTemplate: (value: boolean | ((prev: boolean) => boolean)) => void;
  deletingTemplate: boolean;
  setDeletingTemplate: (value: boolean | ((prev: boolean) => boolean)) => void;
  selectedInspectAssistant: string;
  setSelectedInspectAssistant: (value: string | ((prev: string) => string)) => void;
  suggestedImprovement: string | null;
  setSuggestedImprovement: (value: string | null | ((prev: string | null) => string | null)) => void;
  mgtAnalysisComment: string;
  setMgtAnalysisComment: (value: string | ((prev: string) => string)) => void;
  testCommand: any;
  setTestCommand: (value: any | ((prev: any) => any)) => void;
  mockCommand: string;
  setMockCommand: (value: string | ((prev: string) => string)) => void;
  startCommand: string;
  setStartCommand: (value: string | ((prev: string) => string)) => void;
  resumingWs: string | null;
  setResumingWs: (value: string | null | ((prev: string | null) => string | null)) => void;
  workspaces: Feature[];
  setWorkspaces: (value: Feature[] | ((prev: Feature[]) => Feature[])) => void;
  workspacesLoading: boolean;
  setWorkspacesLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  workspaceStatuses: Record<string, WorkspaceStatus>;
  setWorkspaceStatuses: (value: Record<string, WorkspaceStatus> | ((prev: Record<string, WorkspaceStatus>) => Record<string, WorkspaceStatus>)) => void;
  statusesLoading: boolean;
  setStatusesLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  activeWsId: string | null;
  setActiveWsId: (value: string | null | ((prev: string | null) => string | null)) => void;
  services: ServiceConfig[];
  setServices: (value: ServiceConfig[] | ((prev: ServiceConfig[]) => ServiceConfig[])) => void;
  orchTools: OrchestrationDetection[];
  setOrchTools: (value: OrchestrationDetection[] | ((prev: OrchestrationDetection[]) => OrchestrationDetection[])) => void;
  runningServices: RunningService[];
  setRunningServices: (value: RunningService[] | ((prev: RunningService[]) => RunningService[])) => void;
  servicesLoading: boolean;
  setServicesLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  serviceWorkspaceId: string | null;
  setServiceWorkspaceId: (value: string | null | ((prev: string | null) => string | null)) => void;
  subTab: 'overview' | 'services' | 'changes' | 'sessions' | 'knowledge' | 'plan';
  setSubTab: (value: 'overview' | 'services' | 'changes' | 'sessions' | 'knowledge' | 'plan' | ((prev: 'overview' | 'services' | 'changes' | 'sessions' | 'knowledge' | 'plan') => 'overview' | 'services' | 'changes' | 'sessions' | 'knowledge' | 'plan')) => void;
  sessions: any[];
  setSessions: (value: any[] | ((prev: any[]) => any[])) => void;
  sessionsLoading: boolean;
  setSessionsLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  activeSession: any | null;
  setActiveSession: (value: any | null | ((prev: any | null) => any | null)) => void;
  transcript: any[];
  setTranscript: (value: any[] | ((prev: any[]) => any[])) => void;
  transcriptLoading: boolean;
  setTranscriptLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  gitChanges: any[];
  setGitChanges: (value: any[] | ((prev: any[]) => any[])) => void;
  gitChangesLoading: boolean;
  setGitChangesLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  knowledgeContent: string;
  setKnowledgeContent: (value: string | ((prev: string) => string)) => void;
  knowledgeLoading: boolean;
  setKnowledgeLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  isEditingKnowledge: boolean;
  setIsEditingKnowledge: (value: boolean | ((prev: boolean) => boolean)) => void;
  editedKnowledge: string;
  setEditedKnowledge: (value: string | ((prev: string) => string)) => void;
  saveKnowledgeLoading: boolean;
  setSaveKnowledgeLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  planContent: string;
  setPlanContent: (value: string | ((prev: string) => string)) => void;
  planLoading: boolean;
  setPlanLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  syncLoading: boolean;
  setSyncLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  syncResults: any[] | null;
  setSyncResults: (value: any[] | null | ((prev: any[] | null) => any[] | null)) => void;
  commitMessage: string;
  setCommitMessage: (value: string | ((prev: string) => string)) => void;
  showCommitModal: boolean;
  setShowCommitModal: (value: boolean | ((prev: boolean) => boolean)) => void;
  commitLoading: boolean;
  setCommitLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  commitResults: any[] | null;
  setCommitResults: (value: any[] | null | ((prev: any[] | null) => any[] | null)) => void;
  deleteWsLoading: string | null;
  setDeleteWsLoading: (value: string | null | ((prev: string | null) => string | null)) => void;
  addRepoLoading: boolean;
  setAddRepoLoading: (value: boolean | ((prev: boolean) => boolean)) => void;
  selectedLogService: string | null;
  setSelectedLogService: (value: string | null | ((prev: string | null) => string | null)) => void;
  serviceLogs: string;
  setServiceLogs: (value: string | ((prev: string) => string)) => void;
  recommendation: { totalRamGb: number; gpuName: string; recommendedModel: string } | null;
  setRecommendation: (value: { totalRamGb: number; gpuName: string; recommendedModel: string } | null | ((prev: { totalRamGb: number; gpuName: string; recommendedModel: string } | null) => { totalRamGb: number; gpuName: string; recommendedModel: string } | null)) => void;
  testStatus: { success: boolean; message: string } | null;
  setTestStatus: (value: { success: boolean; message: string } | null | ((prev: { success: boolean; message: string } | null) => { success: boolean; message: string } | null)) => void;
  testingLlm: boolean;
  setTestingLlm: (value: boolean | ((prev: boolean) => boolean)) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: 'dashboard',
  toasts: [],
  config: null,
  configLoading: true,
  configExists: true,
  saveStatus: null,
  adapters: [],
  appVersion: '',
  defaultPaths: null,
  repos: [],
  reposLoading: false,
  repoSearch: '',
  aiAssistants: [],
  editors: [],
  activeStep: 0,
  branchName: '',
  description: '',
  selectedRepos: [],
  selectedAI: [],
  selectedEditor: null,
  localLlmEnabled: false,
  creating: false,
  createdWorkspace: null,
  creationError: null,
  updatingApp: false,
  updateStep: 'idle',
  workflowTemplates: [],
  selectedWorkflowId: 'plan-implement-review',
  customTeamworkInstructions: '',
  suggestingWorkflow: false,
  suggestedDifficulty: null,
  suggestedRationale: '',
  selectedMgtTemplateId: null,
  isEditingTemplate: false,
  mgtTemplateName: '',
  mgtTemplateContent: '',
  analysisResult: null,
  analyzingTemplate: false,
  savingTemplate: false,
  deletingTemplate: false,
  selectedInspectAssistant: 'antigravity',
  suggestedImprovement: null,
  mgtAnalysisComment: '',
  testCommand: 'npm run test',
  mockCommand: '',
  startCommand: '',
  resumingWs: null,
  workspaces: [],
  workspacesLoading: false,
  workspaceStatuses: {},
  statusesLoading: false,
  activeWsId: null,
  services: [],
  orchTools: [],
  runningServices: [],
  servicesLoading: false,
  serviceWorkspaceId: null,
  subTab: 'overview',
  sessions: [],
  sessionsLoading: false,
  activeSession: null,
  transcript: [],
  transcriptLoading: false,
  gitChanges: [],
  gitChangesLoading: false,
  knowledgeContent: '',
  knowledgeLoading: false,
  isEditingKnowledge: false,
  editedKnowledge: '',
  saveKnowledgeLoading: false,
  planContent: '',
  planLoading: false,
  syncLoading: false,
  syncResults: null,
  commitMessage: '',
  showCommitModal: false,
  commitLoading: false,
  commitResults: null,
  deleteWsLoading: null,
  addRepoLoading: false,
  selectedLogService: null,
  serviceLogs: '',
  recommendation: null,
  testStatus: null,
  testingLlm: false,
  setView: (value) => set((state) => ({ view: typeof value === 'function' ? (value as any)(state.view) : value })),
  setToasts: (value) => set((state) => ({ toasts: typeof value === 'function' ? (value as any)(state.toasts) : value })),
  setConfig: (value) => set((state) => ({ config: typeof value === 'function' ? (value as any)(state.config) : value })),
  setConfigLoading: (value) => set((state) => ({ configLoading: typeof value === 'function' ? (value as any)(state.configLoading) : value })),
  setConfigExists: (value) => set((state) => ({ configExists: typeof value === 'function' ? (value as any)(state.configExists) : value })),
  setSaveStatus: (value) => set((state) => ({ saveStatus: typeof value === 'function' ? (value as any)(state.saveStatus) : value })),
  setAdapters: (value) => set((state) => ({ adapters: typeof value === 'function' ? (value as any)(state.adapters) : value })),
  setAppVersion: (value) => set((state) => ({ appVersion: typeof value === 'function' ? (value as any)(state.appVersion) : value })),
  setDefaultPaths: (value) => set((state) => ({ defaultPaths: typeof value === 'function' ? (value as any)(state.defaultPaths) : value })),
  setRepos: (value) => set((state) => ({ repos: typeof value === 'function' ? (value as any)(state.repos) : value })),
  setReposLoading: (value) => set((state) => ({ reposLoading: typeof value === 'function' ? (value as any)(state.reposLoading) : value })),
  setRepoSearch: (value) => set((state) => ({ repoSearch: typeof value === 'function' ? (value as any)(state.repoSearch) : value })),
  setAiAssistants: (value) => set((state) => ({ aiAssistants: typeof value === 'function' ? (value as any)(state.aiAssistants) : value })),
  setEditors: (value) => set((state) => ({ editors: typeof value === 'function' ? (value as any)(state.editors) : value })),
  setActiveStep: (value) => set((state) => ({ activeStep: typeof value === 'function' ? (value as any)(state.activeStep) : value })),
  setBranchName: (value) => set((state) => ({ branchName: typeof value === 'function' ? (value as any)(state.branchName) : value })),
  setDescription: (value) => set((state) => ({ description: typeof value === 'function' ? (value as any)(state.description) : value })),
  setSelectedRepos: (value) => set((state) => ({ selectedRepos: typeof value === 'function' ? (value as any)(state.selectedRepos) : value })),
  setSelectedAI: (value) => set((state) => ({ selectedAI: typeof value === 'function' ? (value as any)(state.selectedAI) : value })),
  setSelectedEditor: (value) => set((state) => ({ selectedEditor: typeof value === 'function' ? (value as any)(state.selectedEditor) : value })),
  setLocalLlmEnabled: (value) => set((state) => ({ localLlmEnabled: typeof value === 'function' ? (value as any)(state.localLlmEnabled) : value })),
  setCreating: (value) => set((state) => ({ creating: typeof value === 'function' ? (value as any)(state.creating) : value })),
  setCreatedWorkspace: (value) => set((state) => ({ createdWorkspace: typeof value === 'function' ? (value as any)(state.createdWorkspace) : value })),
  setCreationError: (value) => set((state) => ({ creationError: typeof value === 'function' ? (value as any)(state.creationError) : value })),
  setUpdatingApp: (value) => set((state) => ({ updatingApp: typeof value === 'function' ? (value as any)(state.updatingApp) : value })),
  setUpdateStep: (value) => set((state) => ({ updateStep: typeof value === 'function' ? (value as any)(state.updateStep) : value })),
  setWorkflowTemplates: (value) => set((state) => ({ workflowTemplates: typeof value === 'function' ? (value as any)(state.workflowTemplates) : value })),
  setSelectedWorkflowId: (value) => set((state) => ({ selectedWorkflowId: typeof value === 'function' ? (value as any)(state.selectedWorkflowId) : value })),
  setCustomTeamworkInstructions: (value) => set((state) => ({ customTeamworkInstructions: typeof value === 'function' ? (value as any)(state.customTeamworkInstructions) : value })),
  setSuggestingWorkflow: (value) => set((state) => ({ suggestingWorkflow: typeof value === 'function' ? (value as any)(state.suggestingWorkflow) : value })),
  setSuggestedDifficulty: (value) => set((state) => ({ suggestedDifficulty: typeof value === 'function' ? (value as any)(state.suggestedDifficulty) : value })),
  setSuggestedRationale: (value) => set((state) => ({ suggestedRationale: typeof value === 'function' ? (value as any)(state.suggestedRationale) : value })),
  setSelectedMgtTemplateId: (value) => set((state) => ({ selectedMgtTemplateId: typeof value === 'function' ? (value as any)(state.selectedMgtTemplateId) : value })),
  setIsEditingTemplate: (value) => set((state) => ({ isEditingTemplate: typeof value === 'function' ? (value as any)(state.isEditingTemplate) : value })),
  setMgtTemplateName: (value) => set((state) => ({ mgtTemplateName: typeof value === 'function' ? (value as any)(state.mgtTemplateName) : value })),
  setMgtTemplateContent: (value) => set((state) => ({ mgtTemplateContent: typeof value === 'function' ? (value as any)(state.mgtTemplateContent) : value })),
  setAnalysisResult: (value) => set((state) => ({ analysisResult: typeof value === 'function' ? (value as any)(state.analysisResult) : value })),
  setAnalyzingTemplate: (value) => set((state) => ({ analyzingTemplate: typeof value === 'function' ? (value as any)(state.analyzingTemplate) : value })),
  setSavingTemplate: (value) => set((state) => ({ savingTemplate: typeof value === 'function' ? (value as any)(state.savingTemplate) : value })),
  setDeletingTemplate: (value) => set((state) => ({ deletingTemplate: typeof value === 'function' ? (value as any)(state.deletingTemplate) : value })),
  setSelectedInspectAssistant: (value) => set((state) => ({ selectedInspectAssistant: typeof value === 'function' ? (value as any)(state.selectedInspectAssistant) : value })),
  setSuggestedImprovement: (value) => set((state) => ({ suggestedImprovement: typeof value === 'function' ? (value as any)(state.suggestedImprovement) : value })),
  setMgtAnalysisComment: (value) => set((state) => ({ mgtAnalysisComment: typeof value === 'function' ? (value as any)(state.mgtAnalysisComment) : value })),
  setTestCommand: (value) => set((state) => ({ testCommand: typeof value === 'function' ? (value as any)(state.testCommand) : value })),
  setMockCommand: (value) => set((state) => ({ mockCommand: typeof value === 'function' ? (value as any)(state.mockCommand) : value })),
  setStartCommand: (value) => set((state) => ({ startCommand: typeof value === 'function' ? (value as any)(state.startCommand) : value })),
  setResumingWs: (value) => set((state) => ({ resumingWs: typeof value === 'function' ? (value as any)(state.resumingWs) : value })),
  setWorkspaces: (value) => set((state) => ({ workspaces: typeof value === 'function' ? (value as any)(state.workspaces) : value })),
  setWorkspacesLoading: (value) => set((state) => ({ workspacesLoading: typeof value === 'function' ? (value as any)(state.workspacesLoading) : value })),
  setWorkspaceStatuses: (value) => set((state) => ({ workspaceStatuses: typeof value === 'function' ? (value as any)(state.workspaceStatuses) : value })),
  setStatusesLoading: (value) => set((state) => ({ statusesLoading: typeof value === 'function' ? (value as any)(state.statusesLoading) : value })),
  setActiveWsId: (value) => set((state) => ({ activeWsId: typeof value === 'function' ? (value as any)(state.activeWsId) : value })),
  setServices: (value) => set((state) => ({ services: typeof value === 'function' ? (value as any)(state.services) : value })),
  setOrchTools: (value) => set((state) => ({ orchTools: typeof value === 'function' ? (value as any)(state.orchTools) : value })),
  setRunningServices: (value) => set((state) => ({ runningServices: typeof value === 'function' ? (value as any)(state.runningServices) : value })),
  setServicesLoading: (value) => set((state) => ({ servicesLoading: typeof value === 'function' ? (value as any)(state.servicesLoading) : value })),
  setServiceWorkspaceId: (value) => set((state) => ({ serviceWorkspaceId: typeof value === 'function' ? (value as any)(state.serviceWorkspaceId) : value })),
  setSubTab: (value) => set((state) => ({ subTab: typeof value === 'function' ? (value as any)(state.subTab) : value })),
  setSessions: (value) => set((state) => ({ sessions: typeof value === 'function' ? (value as any)(state.sessions) : value })),
  setSessionsLoading: (value) => set((state) => ({ sessionsLoading: typeof value === 'function' ? (value as any)(state.sessionsLoading) : value })),
  setActiveSession: (value) => set((state) => ({ activeSession: typeof value === 'function' ? (value as any)(state.activeSession) : value })),
  setTranscript: (value) => set((state) => ({ transcript: typeof value === 'function' ? (value as any)(state.transcript) : value })),
  setTranscriptLoading: (value) => set((state) => ({ transcriptLoading: typeof value === 'function' ? (value as any)(state.transcriptLoading) : value })),
  setGitChanges: (value) => set((state) => ({ gitChanges: typeof value === 'function' ? (value as any)(state.gitChanges) : value })),
  setGitChangesLoading: (value) => set((state) => ({ gitChangesLoading: typeof value === 'function' ? (value as any)(state.gitChangesLoading) : value })),
  setKnowledgeContent: (value) => set((state) => ({ knowledgeContent: typeof value === 'function' ? (value as any)(state.knowledgeContent) : value })),
  setKnowledgeLoading: (value) => set((state) => ({ knowledgeLoading: typeof value === 'function' ? (value as any)(state.knowledgeLoading) : value })),
  setIsEditingKnowledge: (value) => set((state) => ({ isEditingKnowledge: typeof value === 'function' ? (value as any)(state.isEditingKnowledge) : value })),
  setEditedKnowledge: (value) => set((state) => ({ editedKnowledge: typeof value === 'function' ? (value as any)(state.editedKnowledge) : value })),
  setSaveKnowledgeLoading: (value) => set((state) => ({ saveKnowledgeLoading: typeof value === 'function' ? (value as any)(state.saveKnowledgeLoading) : value })),
  setPlanContent: (value) => set((state) => ({ planContent: typeof value === 'function' ? (value as any)(state.planContent) : value })),
  setPlanLoading: (value) => set((state) => ({ planLoading: typeof value === 'function' ? (value as any)(state.planLoading) : value })),
  setSyncLoading: (value) => set((state) => ({ syncLoading: typeof value === 'function' ? (value as any)(state.syncLoading) : value })),
  setSyncResults: (value) => set((state) => ({ syncResults: typeof value === 'function' ? (value as any)(state.syncResults) : value })),
  setCommitMessage: (value) => set((state) => ({ commitMessage: typeof value === 'function' ? (value as any)(state.commitMessage) : value })),
  setShowCommitModal: (value) => set((state) => ({ showCommitModal: typeof value === 'function' ? (value as any)(state.showCommitModal) : value })),
  setCommitLoading: (value) => set((state) => ({ commitLoading: typeof value === 'function' ? (value as any)(state.commitLoading) : value })),
  setCommitResults: (value) => set((state) => ({ commitResults: typeof value === 'function' ? (value as any)(state.commitResults) : value })),
  setDeleteWsLoading: (value) => set((state) => ({ deleteWsLoading: typeof value === 'function' ? (value as any)(state.deleteWsLoading) : value })),
  setAddRepoLoading: (value) => set((state) => ({ addRepoLoading: typeof value === 'function' ? (value as any)(state.addRepoLoading) : value })),
  setSelectedLogService: (value) => set((state) => ({ selectedLogService: typeof value === 'function' ? (value as any)(state.selectedLogService) : value })),
  setServiceLogs: (value) => set((state) => ({ serviceLogs: typeof value === 'function' ? (value as any)(state.serviceLogs) : value })),
  setRecommendation: (value) => set((state) => ({ recommendation: typeof value === 'function' ? (value as any)(state.recommendation) : value })),
  setTestStatus: (value) => set((state) => ({ testStatus: typeof value === 'function' ? (value as any)(state.testStatus) : value })),
  setTestingLlm: (value) => set((state) => ({ testingLlm: typeof value === 'function' ? (value as any)(state.testingLlm) : value })),
}));
