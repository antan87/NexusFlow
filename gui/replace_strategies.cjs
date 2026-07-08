const fs = require('fs');
const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');
const newLines = [];
let i = 0;
while (i < lines.length) {
  if (lines[i].includes("{/* View: Workflows View */}")) {
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
    // skip until we find the end of workflows view, which is right before View: Settings
    i++;
    while (i < lines.length && !lines[i].includes("{/* View: Settings */}")) {
      i++;
    }
  } else {
    newLines.push(lines[i]);
    i++;
  }
}
fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('Replaced Strategies view using node script.');
