const fs = require('fs');
const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  // Replace imports
  if (lines[i].includes("import { DashboardPage } from './pages/DashboardPage.js';")) {
    newLines.push(lines[i]);
    newLines.push("import { SettingsPage } from './pages/SettingsPage.js';");
    newLines.push("import { WizardPage } from './pages/WizardPage.js';");
    newLines.push("import { StrategiesPage } from './pages/StrategiesPage.js';");
  }
  // Remove unwanted imports
  else if (lines[i].includes("Terminal,") || lines[i].includes("AlertTriangle,") || 
           lines[i].includes("ArrowLeft,") || lines[i].includes("Search,")) {
    // skip
  }
  // Replace view === 'create'
  else if (lines[i].includes("{/* View 1: Wizard Workspace Builder */}")) {
    newLines.push(lines[i]);
    newLines.push(`            {view === 'create' && (
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
    // Skip to next view
    while (i < lines.length && !lines[i].includes("{/* View 2: Active Workspaces (master-detail) */}")) {
      i++;
    }
    i--; // So the next iteration picks up View 2
  }
  // Replace view === 'workflows'
  else if (lines[i].includes("{/* View: Workflows View */}")) {
    newLines.push(lines[i]);
    newLines.push(`            {view === 'workflows' && (
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
              />
            )}`);
    // Skip to next view
    while (i < lines.length && !lines[i].includes("{/* View 3: Settings View */}")) {
      i++;
    }
    i--;
  }
  // Replace view === 'settings'
  else if (lines[i].includes("{/* View 3: Settings View */}")) {
    newLines.push(lines[i]);
    newLines.push(`            {view === 'settings' && config && (
              <SettingsPage
                config={config}
                setConfig={setConfig}
                saveAppConfig={saveAppConfig}
                localLlmEnabled={localLlmEnabled}
                setLocalLlmEnabled={setLocalLlmEnabled}
              />
            )}`);
    // Skip to the end of the view
    let braceCount = 1;
    i++;
    while (i < lines.length && braceCount > 0) {
      if (lines[i].includes("</div")) braceCount--;
      if (lines[i].includes("<div")) braceCount++;
      if (lines[i].includes("{/* Right column: Action Panel & Chat */}")) {
        i--;
        break; // Reached next section
      }
      i++;
    }
    // Make sure we didn't eat something important, let's just find the next section.
  }
  else {
    newLines.push(lines[i]);
  }
}

// Clean up unused functions
const finalLines = [];
let skip = false;
for (let j = 0; j < newLines.length; j++) {
  if (newLines[j].includes("const handleToggleRepo = (repo: RepoInfo) => {")) {
    skip = true;
  } else if (skip && newLines[j].includes("};") && newLines[j-1] && newLines[j-1].includes("setSelectedRepos")) {
    skip = false;
    continue;
  }
  
  if (newLines[j].includes("const handleToggleAI = (aiName: string) => {")) {
    skip = true;
  } else if (skip && newLines[j].includes("};") && newLines[j-1] && newLines[j-1].includes("setSelectedAI")) {
    skip = false;
    continue;
  }

  if (newLines[j].includes("const filteredRepos = repos.filter((r) =>")) {
    skip = true;
  } else if (skip && newLines[j].includes(");") && newLines[j-1] && newLines[j-1].includes("r.name.toLowerCase().includes")) {
    skip = false;
    continue;
  }

  if (!skip) {
    finalLines.push(newLines[j]);
  }
}


fs.writeFileSync('src/App.tsx', finalLines.join('\n'));
console.log('App.tsx rewrite completed!');
