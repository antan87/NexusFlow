const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

const view1Start = lines.findIndex(l => l.includes('{/* View 1: Wizard Workspace Builder */}'));
const view1End = lines.findIndex(l => l.includes('{/* View 2: Active Workspaces (master-detail) */}')) - 1;

const viewWfStart = lines.findIndex(l => l.includes('{/* View: Workflows View */}'));
const viewWfEnd = lines.findIndex(l => l.includes('{/* View 3: Settings View */}')) - 1;

// Extract StrategiesPage
let strategiesJSX = lines.slice(viewWfStart + 1, viewWfEnd).join('\n');
strategiesJSX = strategiesJSX.replace(/\{\s*view === 'workflows' && \(\s*/, '');
strategiesJSX = strategiesJSX.replace(/\s*\)\}\s*$/, '');

const strategiesContent = `import React from 'react';
import { PlusCircle, Sparkles, Check, Trash2, ArrowRight, FolderOpen, RefreshCw, Cpu, CheckCircle } from 'lucide-react';

interface StrategiesPageProps {
  workflowTemplates: any[];
  isEditingTemplate: boolean;
  setIsEditingTemplate: React.Dispatch<React.SetStateAction<boolean>>;
  mgtTemplateName: string;
  setMgtTemplateName: React.Dispatch<React.SetStateAction<string>>;
  mgtTemplateContent: string;
  setMgtTemplateContent: React.Dispatch<React.SetStateAction<string>>;
  selectedMgtTemplateId: string | null;
  setSelectedMgtTemplateId: React.Dispatch<React.SetStateAction<string | null>>;
  analysisResult: any;
  setAnalysisResult: React.Dispatch<React.SetStateAction<any>>;
  templateAnalysisLoading: boolean;
  handleAnalyzeTemplate: (id: string, content: string, harness: string) => Promise<void>;
  handleSaveTemplate: () => Promise<void>;
  handleDeleteTemplate: (id: string) => Promise<void>;
  aiAssistants: any[];
  analyzingTemplate: boolean;
  mgtAnalysisComment: string;
  setMgtAnalysisComment: React.Dispatch<React.SetStateAction<string>>;
  suggestedImprovement: string | null;
  setSuggestedImprovement: React.Dispatch<React.SetStateAction<string | null>>;
  savingTemplate: boolean;
  deletingTemplate: boolean;
  selectedInspectAssistant: string;
  setSelectedInspectAssistant: React.Dispatch<React.SetStateAction<string>>;
}

export function StrategiesPage(props: StrategiesPageProps) {
  const {
    workflowTemplates,
    isEditingTemplate, setIsEditingTemplate,
    mgtTemplateName, setMgtTemplateName,
    mgtTemplateContent, setMgtTemplateContent,
    selectedMgtTemplateId, setSelectedMgtTemplateId,
    analysisResult, setAnalysisResult,
    templateAnalysisLoading, handleAnalyzeTemplate,
    handleSaveTemplate, handleDeleteTemplate,
    aiAssistants, analyzingTemplate,
    mgtAnalysisComment, setMgtAnalysisComment,
    suggestedImprovement, setSuggestedImprovement,
    savingTemplate, deletingTemplate,
    selectedInspectAssistant, setSelectedInspectAssistant
  } = props;

  return (
    ${strategiesJSX}
  );
}
`;

fs.writeFileSync('src/pages/StrategiesPage.tsx', strategiesContent);
console.log('Created StrategiesPage.tsx');

// Rewrite App.tsx
const newLines = [];
let i = 0;
while (i < lines.length) {
  if (lines[i].includes("import { DashboardPage } from './pages/DashboardPage.js';")) {
    newLines.push(lines[i]);
    newLines.push("import { SettingsPage } from './pages/SettingsPage.js';");
    newLines.push("import { WizardPage } from './pages/WizardPage.js';");
    newLines.push("import { StrategiesPage } from './pages/StrategiesPage.js';");
  }
  else if (lines[i].includes('Terminal,') || lines[i].includes('AlertTriangle,') || 
           lines[i].includes('ArrowLeft,') || lines[i].includes('Search,')) {
    // skip
  }
  else if (i === view1Start) {
    newLines.push(`            {/* View 1: Wizard Workspace Builder */}
            {view === 'create' && (
              <WizardPage
                activeStep={activeStep}
                setActiveStep={setActiveStep}
                branchName={branchName}
                setBranchName={setBranchName}
                description={description}
                setDescription={setDescription}
                repos={repos}
                reposLoading={reposLoading}
                repoSearch={repoSearch}
                setRepoSearch={setRepoSearch}
                selectedRepos={selectedRepos}
                setSelectedRepos={setSelectedRepos}
                aiAssistants={aiAssistants}
                selectedAI={selectedAI}
                setSelectedAI={setSelectedAI}
                editors={editors}
                selectedEditor={selectedEditor}
                setSelectedEditor={setSelectedEditor}
                config={config}
                setConfig={setConfig}
                saveAppConfig={saveAppConfig}
                localLlmEnabled={localLlmEnabled}
                setLocalLlmEnabled={setLocalLlmEnabled}
                testCommand={testCommand}
                setTestCommand={setTestCommand}
                mockCommand={mockCommand}
                setMockCommand={setMockCommand}
                startCommand={startCommand}
                setStartCommand={setStartCommand}
                suggestingWorkflow={suggestingWorkflow}
                handleSuggestWorkflow={handleSuggestWorkflow}
                suggestedDifficulty={suggestedDifficulty}
                suggestedRationale={suggestedRationale}
                workflowTemplates={workflowTemplates}
                selectedWorkflowId={selectedWorkflowId}
                setSelectedWorkflowId={setSelectedWorkflowId}
                customTeamworkInstructions={customTeamworkInstructions}
                setCustomTeamworkInstructions={setCustomTeamworkInstructions}
                creating={creating}
                handleCreateWorkspace={handleCreateWorkspace}
                creationSteps={creationSteps}
                creationError={creationError}
                setCreating={setCreating}
                setCreationError={setCreationError}
                createdWorkspace={createdWorkspace}
                fetchWorkspaces={fetchWorkspaces}
                handleOpenInEditor={handleOpenInEditor}
              />
            )}`);
    i = view1End;
  }
  else if (i === viewWfStart) {
    newLines.push(`            {/* View: Workflows View */}
            {view === 'workflows' && (
              <StrategiesPage
                workflowTemplates={workflowTemplates}
                isEditingTemplate={isEditingTemplate}
                setIsEditingTemplate={setIsEditingTemplate}
                mgtTemplateName={mgtTemplateName}
                setMgtTemplateName={setMgtTemplateName}
                mgtTemplateContent={mgtTemplateContent}
                setMgtTemplateContent={setMgtTemplateContent}
                selectedMgtTemplateId={selectedMgtTemplateId}
                setSelectedMgtTemplateId={setSelectedMgtTemplateId}
                analysisResult={analysisResult}
                setAnalysisResult={setAnalysisResult}
                templateAnalysisLoading={templateAnalysisLoading}
                handleAnalyzeTemplate={handleAnalyzeTemplate}
                handleSaveTemplate={handleSaveTemplate}
                handleDeleteTemplate={handleDeleteTemplate}
                aiAssistants={aiAssistants}
                analyzingTemplate={analyzingTemplate}
                mgtAnalysisComment={mgtAnalysisComment}
                setMgtAnalysisComment={setMgtAnalysisComment}
                suggestedImprovement={suggestedImprovement}
                setSuggestedImprovement={setSuggestedImprovement}
                savingTemplate={savingTemplate}
                deletingTemplate={deletingTemplate}
                selectedInspectAssistant={selectedInspectAssistant}
                setSelectedInspectAssistant={setSelectedInspectAssistant}
              />
            )}`);
    i = viewWfEnd;
  }
  else {
    newLines.push(lines[i]);
  }
  i++;
}

// Clean up unused functions
const finalLines = [];
let skip = false;
for (let j = 0; j < newLines.length; j++) {
  if (newLines[j].includes('const handleToggleRepo = (repo: RepoInfo) => {')) {
    skip = true;
  } else if (skip && newLines[j].includes('};') && newLines[j-1] && newLines[j-1].includes('setSelectedRepos')) {
    skip = false;
    continue;
  }
  
  if (newLines[j].includes('const handleToggleAI = (aiName: string) => {')) {
    skip = true;
  } else if (skip && newLines[j].includes('};') && newLines[j-1] && newLines[j-1].includes('setSelectedAI')) {
    skip = false;
    continue;
  }

  if (newLines[j].includes('const filteredRepos = repos.filter((r) =>')) {
    skip = true;
  } else if (skip && newLines[j].includes(');') && newLines[j-1] && newLines[j-1].includes('r.name.toLowerCase().includes')) {
    skip = false;
    continue;
  }

  if (!skip) {
    finalLines.push(newLines[j]);
  }
}

fs.writeFileSync('src/App.tsx', finalLines.join('\n'));
console.log('Rewrote App.tsx');
