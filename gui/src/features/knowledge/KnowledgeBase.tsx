import React from 'react';
import { BookOpen, RefreshCw, Save, Edit } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Spinner } from '../../components/ui/spinner.js';

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
    <div className="rounded-xl border border-border bg-card p-4">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookOpen size={16} className="text-info" /> Persistent Knowledge Memory (nexusflow-knowledge.md)
        </h4>
        <div className="flex gap-2">
          {isEditingKnowledge ? (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  setEditedKnowledge(knowledgeContent);
                  setIsEditingKnowledge(false);
                }}
                disabled={saveKnowledgeLoading}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={() => handleSaveKnowledge(ws.branchName)}
                disabled={saveKnowledgeLoading}
              >
                {saveKnowledgeLoading ? <Spinner className="size-3" /> : <Save size={10} />} Save
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setIsEditingKnowledge(true)}
              disabled={knowledgeLoading}
            >
              <Edit size={10} /> Edit Knowledge
            </Button>
          )}
        </div>
      </header>

      {knowledgeLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-primary" size={20} />
        </div>
      ) : isEditingKnowledge ? (
        <Textarea
          className="[&_[data-slot=textarea]]:h-96 [&_[data-slot=textarea]]:resize-y [&_[data-slot=textarea]]:font-mono [&_[data-slot=textarea]]:text-xs"
          value={editedKnowledge}
          onChange={(e) => setEditedKnowledge(e.target.value)}
        />
      ) : (
        <div className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {knowledgeContent || "No knowledge file generated yet."}
        </div>
      )}
    </div>
  );
};
