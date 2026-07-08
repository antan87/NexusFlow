const fs = require('fs');
const { execSync } = require('child_process');
const content = execSync('git show HEAD:gui/src/App.tsx').toString();
const lines = content.split('\n');

const viewWfStart = lines.findIndex(l => l.includes('{/* View: Workflows View */}'));
const viewWfEnd = lines.findIndex(l => l.includes('{/* View 3: Settings View */}')) - 1;

let strategiesJSX = lines.slice(viewWfStart + 1, viewWfEnd).join('\n');
strategiesJSX = strategiesJSX.replace(/\{\s*view === 'workflows' && \(\s*/, '');
strategiesJSX = strategiesJSX.replace(/\s*\)\}\s*$/, '');

const strategiesContent = `import React from 'react';
import { PlusCircle, Sparkles, Check, Trash2, ArrowRight, FolderOpen, RefreshCw, Cpu, CheckCircle } from 'lucide-react';
import { showToast } from '../lib/apiBase.js';

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
