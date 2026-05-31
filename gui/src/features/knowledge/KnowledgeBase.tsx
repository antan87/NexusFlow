import React from 'react';
import { BookOpen, RefreshCw, Save, Edit } from 'lucide-react';
import type { Feature } from '../../types.js';

interface KnowledgeBaseProps {
  ws: Feature;
  knowledgeContent: string;
  knowledgeLoading: boolean;
  isEditingKnowledge: boolean;
  editedKnowledge: string;
  saveKnowledgeLoading: boolean;
  setEditedKnowledge: (val: string) => void;
  setIsEditingKnowledge: (val: boolean) => void;
  handleSaveKnowledge: (wsId: string) => Promise<void>;
}

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({
  ws,
  knowledgeContent,
  knowledgeLoading,
  isEditingKnowledge,
  editedKnowledge,
  saveKnowledgeLoading,
  setEditedKnowledge,
  setIsEditingKnowledge,
  handleSaveKnowledge,
}) => {
  return (
    <div className="bg-[#090d1a]/20 border border-gray-800/60 rounded-xl p-4">
      <header className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <BookOpen size={16} className="text-cyan-400" /> Persistent Knowledge Memory (nexusflow-knowledge.md)
        </h4>
        <div className="flex gap-2">
          {isEditingKnowledge ? (
            <>
              <button
                className="px-2.5 py-1.5 bg-gray-900 border border-gray-800 hover:bg-gray-850 rounded-lg text-[10px] font-semibold transition-all cursor-pointer text-gray-400"
                onClick={() => {
                  setEditedKnowledge(knowledgeContent);
                  setIsEditingKnowledge(false);
                }}
                disabled={saveKnowledgeLoading}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-650 hover:bg-indigo-600 text-white rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                onClick={() => handleSaveKnowledge(ws.branchName)}
                disabled={saveKnowledgeLoading}
              >
                {saveKnowledgeLoading ? <RefreshCw className="animate-spin" size={10} /> : <Save size={10} />} Save
              </button>
            </>
          ) : (
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-[10px] font-semibold transition-all cursor-pointer text-gray-350"
              onClick={() => setIsEditingKnowledge(true)}
              disabled={knowledgeLoading}
            >
              <Edit size={10} /> Edit Knowledge
            </button>
          )}
        </div>
      </header>

      {knowledgeLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-indigo-400" size={20} />
        </div>
      ) : isEditingKnowledge ? (
        <textarea
          className="w-full h-96 bg-gray-950/60 border border-gray-800/80 rounded-xl p-4 text-xs font-mono text-gray-305 focus:outline-none focus:border-indigo-500/80 resize-y"
          value={editedKnowledge}
          onChange={(e) => setEditedKnowledge(e.target.value)}
        />
      ) : (
        <div className="bg-gray-950/40 border border-gray-800/30 rounded-xl p-4 text-gray-350 text-xs leading-relaxed overflow-auto font-mono whitespace-pre-wrap max-h-96">
          {knowledgeContent || "No knowledge file generated yet."}
        </div>
      )}
    </div>
  );
};
