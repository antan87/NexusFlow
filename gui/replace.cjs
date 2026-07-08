const fs = require('fs');
const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');
const newLines = [];
for (let i = 0; i < lines.length; i++) {
  if (i < 2024 || i > 2687) newLines.push(lines[i]);
  else if (i === 2024) {
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
            )`);
  }
}
fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('Replaced Wizard view using node script.');
