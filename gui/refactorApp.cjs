const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

const view1Start = lines.findIndex(l => l.includes('{/* View 1: Wizard Workspace Builder */}'));
const view1End = lines.findIndex(l => l.includes('{/* View 2: Active Workspaces (master-detail) */}')) - 1;

const viewWfStart = lines.findIndex(l => l.includes('{/* View: Workflows View */}'));
const viewWfEnd = lines.findIndex(l => l.includes('{/* View 3: Settings View */}')) - 1;

const viewSettingsStart = lines.findIndex(l => l.includes('{/* View 3: Settings View */}'));
// We find </main> and go back 3 lines to hit the )} of Settings View.
const viewSettingsEnd = lines.findIndex(l => l.includes('</main>')) - 3;

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
    newLines.push('            {/* View 1: Wizard Workspace Builder */}');
    newLines.push("            {view === 'create' && config && (");
    newLines.push('              <WizardPage');
    newLines.push('                activeStep={activeStep} setActiveStep={setActiveStep} branchName={branchName} setBranchName={setBranchName}');
    newLines.push('                description={description} setDescription={setDescription} repos={repos} reposLoading={reposLoading}');
    newLines.push('                repoSearch={repoSearch} setRepoSearch={setRepoSearch} selectedRepos={selectedRepos} setSelectedRepos={setSelectedRepos}');
    newLines.push('                aiAssistants={aiAssistants} selectedAI={selectedAI} setSelectedAI={setSelectedAI}');
    newLines.push('                editors={editors} selectedEditor={selectedEditor} setSelectedEditor={setSelectedEditor}');
    newLines.push('                config={config} setConfig={setConfig} saveAppConfig={saveAppConfig} localLlmEnabled={localLlmEnabled} setLocalLlmEnabled={setLocalLlmEnabled}');
    newLines.push('                testCommand={testCommand} setTestCommand={setTestCommand} mockCommand={mockCommand} setMockCommand={setMockCommand} startCommand={startCommand} setStartCommand={setStartCommand}');
    newLines.push('                suggestingWorkflow={suggestingWorkflow} handleSuggestWorkflow={handleSuggestWorkflow} suggestedDifficulty={suggestedDifficulty} suggestedRationale={suggestedRationale}');
    newLines.push('                workflowTemplates={workflowTemplates} selectedWorkflowId={selectedWorkflowId} setSelectedWorkflowId={setSelectedWorkflowId}');
    newLines.push('                customTeamworkInstructions={customTeamworkInstructions} setCustomTeamworkInstructions={setCustomTeamworkInstructions}');
    newLines.push('                creating={creating} handleCreateWorkspace={handleCreateWorkspace} creationSteps={creationSteps} creationError={creationError}');
    newLines.push('                setCreating={setCreating} setCreationError={setCreationError} createdWorkspace={createdWorkspace}');
    newLines.push('              />');
    newLines.push('            )}');
    i = view1End;
  }
  else if (i === viewWfStart) {
    newLines.push('            {/* View: Workflows View */}');
    newLines.push("            {view === 'workflows' && (");
    newLines.push('              <StrategiesPage');
    newLines.push('                workflowTemplates={workflowTemplates} isEditingTemplate={isEditingTemplate} setIsEditingTemplate={setIsEditingTemplate}');
    newLines.push('                mgtTemplateName={mgtTemplateName} setMgtTemplateName={setMgtTemplateName} mgtTemplateContent={mgtTemplateContent} setMgtTemplateContent={setMgtTemplateContent}');
    newLines.push('                selectedMgtTemplateId={selectedMgtTemplateId} setSelectedMgtTemplateId={setSelectedMgtTemplateId}');
    newLines.push('                analysisResult={analysisResult} setAnalysisResult={setAnalysisResult} showToast={showToast}');
    newLines.push('                handleAnalyzeTemplate={handleAnalyzeTemplate} handleSaveTemplate={handleSaveTemplate} handleDeleteTemplate={handleDeleteTemplate}');
    newLines.push('                aiAssistants={aiAssistants} analyzingTemplate={analyzingTemplate} mgtAnalysisComment={mgtAnalysisComment} setMgtAnalysisComment={setMgtAnalysisComment}');
    newLines.push('                suggestedImprovement={suggestedImprovement} setSuggestedImprovement={setSuggestedImprovement} savingTemplate={savingTemplate} deletingTemplate={deletingTemplate}');
    newLines.push('                selectedInspectAssistant={selectedInspectAssistant} setSelectedInspectAssistant={setSelectedInspectAssistant}');
    newLines.push('              />');
    newLines.push('            )}');
    i = viewWfEnd;
  }
  else if (i === viewSettingsStart) {
    newLines.push('            {/* View 3: Settings View */}');
    newLines.push("            {view === 'settings' && config && (");
    newLines.push('              <SettingsPage');
    newLines.push('                config={config} setConfig={setConfig} saveStatus={saveStatus} editors={editors} adapters={adapters}');
    newLines.push('                saveAppConfig={saveAppConfig} isSettingsFormValid={isSettingsFormValid} recommendation={recommendation}');
    newLines.push('                testingLlm={testingLlm} testStatus={testStatus}');
    newLines.push('              />');
    newLines.push('            )}');
    i = viewSettingsEnd;
  }
  else {
    newLines.push(lines[i]);
  }
  i++;
}

fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('App.tsx rewritten.');
