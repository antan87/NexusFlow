const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

const view1Start = lines.findIndex(l => l.includes('{/* View 1: Wizard Workspace Builder */}'));
const view1End = lines.findIndex(l => l.includes('{/* View 2: Active Workspaces (master-detail) */}')) - 1;

const viewWfStart = lines.findIndex(l => l.includes('{/* View: Workflows View */}'));
const viewWfEnd = lines.findIndex(l => l.includes('{/* View 3: Settings View */}')) - 1;

const view3Start = lines.findIndex(l => l.includes('{/* View 3: Settings View */}'));

let view3End = view3Start;
let braceCount = 0;
let started = false;
for(let i=view3Start; i<lines.length; i++) {
  if (lines[i].includes('<div')) braceCount++;
  if (lines[i].includes('</div')) braceCount--;
  if (braceCount > 0) started = true;
  if (started && braceCount === 0) {
    let end = i;
    for(let j=i+1; j<i+5; j++) {
      if (lines[j].trim() === ')}') {
        end = j;
        break;
      }
    }
    view3End = end;
    break;
  }
}

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
                showToast={showToast}
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
  else if (i === view3Start) {
    newLines.push(`            {/* View 3: Settings View */}
            {view === 'settings' && config && (
              <SettingsPage
                config={config}
                setConfig={setConfig}
                saveStatus={saveStatus}
                editors={editors}
                adapters={adapters}
                saveAppConfig={saveAppConfig}
                isSettingsFormValid={isSettingsFormValid}
                recommendation={recommendation}
                testingLlm={testingLlm}
                testStatus={testStatus}
                testLlmConnection={testLlmConnection}
              />
            )}`);
    i = view3End;
  }
  else {
    newLines.push(lines[i]);
  }
  i++;
}

for (let i = 0; i < 30; i++) {
  if (newLines[i]) {
    newLines[i] = newLines[i].replace('Terminal, ', '');
    newLines[i] = newLines[i].replace('AlertTriangle, ', '');
    newLines[i] = newLines[i].replace('FolderOpen, ', '');
    newLines[i] = newLines[i].replace('ArrowLeft, ', '');
    newLines[i] = newLines[i].replace('Search, ', '');
    newLines[i] = newLines[i].replace('Trash2, ', '');
    newLines[i] = newLines[i].replace('CheckCircle, ', '');
    newLines[i] = newLines[i].replace('Cpu, ', '');
  }
}

fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('App.tsx rewritten successfully!');
