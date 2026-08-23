import React, { useState } from 'react';
import { BookOpen, RefreshCw, Save, Edit, FileText, Code } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Spinner } from '../../components/ui/spinner.js';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';

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
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  return (
    <div className="rounded-lg border border-border bg-card p-4 surface-card">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookOpen size={16} className="text-primary" /> Persistent Knowledge Memory (nexusflow-knowledge.md)
        </h4>
        <div className="flex items-center gap-2">
          {!isEditingKnowledge && knowledgeContent && (
            <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-md border border-border/60">
              <Button
                size="xs"
                variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('preview')}
                className="text-[11px] gap-1 px-2"
              >
                <FileText size={11} /> Preview
              </Button>
              <Button
                size="xs"
                variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('raw')}
                className="text-[11px] gap-1 px-2"
              >
                <Code size={11} /> Raw
              </Button>
            </div>
          )}
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
      ) : !knowledgeContent ? (
        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          No knowledge file generated yet.
        </div>
      ) : viewMode === 'preview' ? (
        <div data-vim-scroll className="max-h-[500px] overflow-auto rounded-md border border-border/70 bg-muted/20 p-4">
          <ChatMarkdown content={knowledgeContent} />
        </div>
      ) : (
        <div data-vim-scroll className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {knowledgeContent}
        </div>
      )}
    </div>
  );
};
