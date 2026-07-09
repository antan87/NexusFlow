import React from 'react';
import { PlusCircle, Sparkles, Trash2, FolderOpen, RefreshCw, Cpu, CheckCircle } from 'lucide-react';

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
  showToast: (msg: string, type?: 'success'|'error'|'info', dur?: number) => void;
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
    showToast, handleAnalyzeTemplate,
    handleSaveTemplate, handleDeleteTemplate,
    aiAssistants, analyzingTemplate,
    mgtAnalysisComment, setMgtAnalysisComment,
    suggestedImprovement, setSuggestedImprovement,
    savingTemplate, deletingTemplate,
    selectedInspectAssistant, setSelectedInspectAssistant
  } = props;

  return (
                <div className="max-w-6xl mx-auto">
                <header className="mb-8">
                  <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Team Collaboration Strategies</h1>
                  <p className="text-sm text-gray-400 font-sans">Predefine and review custom teamwork guidelines injected into workspaces' AGENTS.md files.</p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
                  {/* Left sidebar: Strategy List */}
                  <div className="lg:col-span-4 flex flex-col gap-4">
                    <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-5 shadow-md flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Strategies</h3>
                        <button
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white transition-all cursor-pointer shadow-md shadow-indigo-500/10"
                          onClick={() => {
                            setIsEditingTemplate(true);
                            setMgtTemplateName('New Strategy');
                            setMgtTemplateContent('# New Strategy\n\nWrite custom teamwork rules here for subagent orchestration...');
                            setSelectedMgtTemplateId(null);
                            setAnalysisResult(null);
                          }}
                        >
                          <PlusCircle size={12} /> Add New
                        </button>
                      </div>

                      <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-1">
                        {workflowTemplates.map((template) => {
                          const isSelected = selectedMgtTemplateId === template.id;
                          return (
                            <div
                              key={template.id}
                              className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-1.5 ${
                                isSelected
                                  ? 'border-indigo-500 bg-indigo-500/5'
                                  : 'border-gray-800/80 bg-gray-900/10 hover:border-gray-700/60 hover:bg-gray-800/10'
                              }`}
                              onClick={() => {
                                setSelectedMgtTemplateId(template.id);
                                setIsEditingTemplate(false);
                                setMgtTemplateName(template.name);
                                setMgtTemplateContent(template.content);
                                setAnalysisResult(null);
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-xs font-bold ${isSelected ? 'text-indigo-400' : 'text-white'}`}>
                                  {template.name}
                                </span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider font-semibold border ${
                                    template.custom
                                      ? 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5'
                                      : 'text-gray-400 border-gray-800 bg-gray-800/20'
                                  }`}
                                >
                                  {template.custom ? 'Custom' : 'Built-in'}
                                </span>
                              </div>
                              <p className="text-[10px] text-gray-500 line-clamp-2 leading-relaxed font-sans">
                                {template.description}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right side: Strategy Detail / Edit Panel */}
                  <div className="lg:col-span-8 flex flex-col gap-6">
                    {(selectedMgtTemplateId || isEditingTemplate) ? (
                      <div className="bg-surface/40 border border-gray-800/80 rounded-xl p-6 shadow-md flex flex-col gap-5">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            {isEditingTemplate ? (
                              <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Strategy Name</label>
                                <input
                                  type="text"
                                  className="w-full bg-surface border border-gray-850 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-2 text-white text-sm outline-none transition-all"
                                  value={mgtTemplateName}
                                  onChange={(e) => setMgtTemplateName(e.target.value)}
                                  placeholder="e.g. Test-Driven Development"
                                />
                              </div>
                            ) : (
                              <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                  {mgtTemplateName}
                                  {workflowTemplates.find(t => t.id === selectedMgtTemplateId)?.custom && (
                                    <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 uppercase">
                                      Custom Template
                                    </span>
                                  )}
                                </h2>
                                <p className="text-xs text-gray-500 mt-1 font-sans">
                                  {workflowTemplates.find(t => t.id === selectedMgtTemplateId)?.description || 'Custom strategy template.'}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2">
                            {isEditingTemplate ? (
                              <>
                                <button
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                                  onClick={() => {
                                    if (selectedMgtTemplateId) {
                                      const original = workflowTemplates.find(t => t.id === selectedMgtTemplateId);
                                      if (original) {
                                        setMgtTemplateName(original.name);
                                        setMgtTemplateContent(original.content);
                                      }
                                      setIsEditingTemplate(false);
                                    } else {
                                      setIsEditingTemplate(false);
                                      if (workflowTemplates.length > 0) {
                                        const first = workflowTemplates[0];
                                        setSelectedMgtTemplateId(first.id);
                                        setMgtTemplateName(first.name);
                                        setMgtTemplateContent(first.content);
                                      }
                                    }
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white transition-all cursor-pointer shadow-md shadow-indigo-500/10"
                                  onClick={handleSaveTemplate}
                                  disabled={savingTemplate}
                                >
                                  {savingTemplate ? 'Saving...' : 'Save Strategy'}
                                </button>
                              </>
                            ) : (
                              <>
                                {workflowTemplates.find(t => t.id === selectedMgtTemplateId)?.custom && (
                                  <>
                                    <button
                                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                                      onClick={() => setIsEditingTemplate(true)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 transition-all cursor-pointer"
                                      onClick={() => handleDeleteTemplate(selectedMgtTemplateId!)}
                                      disabled={deletingTemplate}
                                    >
                                      <Trash2 size={12} /> Delete
                                    </button>
                                  </>
                                )}
                                {!workflowTemplates.find(t => t.id === selectedMgtTemplateId)?.custom && (
                                  <button
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 text-white transition-all cursor-pointer"
                                    onClick={() => {
                                      setIsEditingTemplate(true);
                                      setMgtTemplateName(`${mgtTemplateName} Copy`);
                                      setMgtTemplateContent(mgtTemplateContent);
                                      setSelectedMgtTemplateId(null);
                                      setAnalysisResult(null);
                                    }}
                                  >
                                    Duplicate & Customize
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Guidelines Markdown</label>
                          <textarea
                            className="w-full bg-surface border border-gray-850 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-3 text-white placeholder-gray-600 transition-all outline-none text-xs font-mono min-h-[250px] resize-y shadow-inner leading-relaxed"
                            value={mgtTemplateContent}
                            onChange={(e) => setMgtTemplateContent(e.target.value)}
                            disabled={!isEditingTemplate}
                            placeholder="Write cooperation guidelines in Markdown..."
                          />
                        </div>

                        {!isEditingTemplate && selectedMgtTemplateId && (
                          <div className="border-t border-gray-800/60 pt-5 flex flex-col gap-4">
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <Sparkles size={14} className="text-indigo-400" /> AI Strategy Analysis
                                  </span>
                                  <span className="text-[10px] text-gray-500 mt-0.5 font-sans">Select an AI assistant harness installed on your system to inspect these guidelines.</span>
                                </div>

                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider font-sans">Harness:</span>
                                    <select
                                      className="bg-gray-900 border border-gray-800 text-xs text-white rounded-lg px-2.5 py-1.5 focus:border-indigo-500 transition-all outline-none disabled:opacity-40"
                                      value={selectedInspectAssistant}
                                      onChange={(e) => setSelectedInspectAssistant(e.target.value)}
                                      disabled={aiAssistants.filter(ai => ai.detected && ai.command).length === 0}
                                    >
                                      {aiAssistants.filter(ai => ai.detected && ai.command).length > 0 ? (
                                        aiAssistants
                                          .filter(ai => ai.detected && ai.command)
                                          .map(ai => (
                                            <option key={ai.name} value={ai.name}>
                                              {ai.displayName}
                                            </option>
                                          ))
                                      ) : (
                                        <option value="">No Harness Found</option>
                                      )}
                                    </select>
                                  </div>

                                  <button
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white transition-all cursor-pointer shadow-md shadow-indigo-500/10 disabled:opacity-40"
                                    onClick={() => handleAnalyzeTemplate(selectedMgtTemplateId, mgtTemplateContent, selectedInspectAssistant)}
                                    disabled={analyzingTemplate || aiAssistants.filter(ai => ai.detected && ai.command).length === 0}
                                  >
                                    {analyzingTemplate ? (
                                      <>
                                        <RefreshCw className="animate-spin" size={12} /> Inspecting...
                                      </>
                                    ) : (
                                      <>
                                        <Cpu size={12} /> Inspect Strategy
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-left">Evaluation Focus / Instructions (Optional)</label>
                                <textarea
                                  className="w-full bg-surface/40 border border-gray-850 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg px-4 py-2 text-white placeholder-gray-600 transition-all outline-none text-xs min-h-[60px] resize-y leading-relaxed font-sans"
                                  value={mgtAnalysisComment}
                                  onChange={(e) => setMgtAnalysisComment(e.target.value)}
                                  placeholder="e.g. Focus on checking if timeouts are handled well, check subagent roles coordination..."
                                  disabled={analyzingTemplate}
                                />
                              </div>
                            </div>

                            {analysisResult && (
                              <div className="flex flex-col gap-4">
                                <div className="bg-[#1e1e38]/20 border border-indigo-500/10 rounded-xl p-5 text-xs text-gray-300 leading-relaxed font-sans max-h-[300px] overflow-y-auto text-left whitespace-pre-wrap select-text">
                                  {analysisResult}
                                </div>
                                {suggestedImprovement && (
                                  <div className="flex justify-end">
                                    <button
                                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition-all cursor-pointer shadow-md shadow-green-600/10"
                                      onClick={() => {
                                        setMgtTemplateContent(suggestedImprovement);
                                        setIsEditingTemplate(true);
                                        setSuggestedImprovement(null);
                                        setAnalysisResult(null);
                                        showToast('Suggested improvements applied! Click Save to persist changes.', 'success');
                                      }}
                                    >
                                      <CheckCircle size={14} /> Apply Suggested Improvements
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                        <div className="max-w-md w-full bg-surface/30 border border-hairline-strong border-dashed rounded-xl flex flex-col items-center justify-center text-center p-8 backdrop-blur-sm shadow-sm">
                          <FolderOpen size={40} className="text-content-faint mb-4" />
                          <span className="text-sm font-semibold text-content">No strategy template selected</span>
                          <p className="text-xs text-content-muted mt-2 max-w-sm font-sans">
                            Select a template from the list to view, edit, or analyze it, or add a new custom teamwork workflow template.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
  );
}
