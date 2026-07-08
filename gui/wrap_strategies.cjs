const fs = require('fs');
let content = fs.readFileSync('src/pages/StrategiesPage.tsx', 'utf-8');

// remove {view === 'workflows' && (
content = content.replace(/\{\s*view === 'workflows' && \(\s*/, '');
// remove the trailing )}
content = content.replace(/\s*\)\}\s*$/, '');

const newContent = `import React from 'react';
import { PlusCircle, Sparkles, Check, Trash2, ArrowRight } from 'lucide-react';

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
  handleAnalyzeTemplate: () => Promise<void>;
  handleSaveTemplate: () => Promise<void>;
  handleDeleteTemplate: (id: string) => Promise<void>;
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
    handleSaveTemplate, handleDeleteTemplate
  } = props;

  return (
    ${content}
  );
}
`;

fs.writeFileSync('src/pages/StrategiesPage.tsx', newContent);
console.log('Wrapped StrategiesPage.tsx');
