import React, { useState } from 'react';
import { AlertTriangle, BookOpen, RefreshCw, Save, Edit, FileText, Code } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Spinner } from '../../components/ui/spinner.js';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';

interface KnowledgeBaseProps {
  ws: Feature;
  knowledgeContent: string;
  knowledgeLoading: boolean;
  knowledgeError: string | null;
  isEditingKnowledge: boolean;
  editedKnowledge: string;
  saveKnowledgeLoading: boolean;
  saveKnowledgeError: string | null;
  setEditedKnowledge: (val: string) => void;
  setIsEditingKnowledge: (val: boolean) => void;
  handleSaveKnowledge: (wsId: string) => Promise<void>;
  handleRetryKnowledge: (wsId: string) => Promise<void>;
}

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({
  ws,
  knowledgeContent,
  knowledgeLoading,
  knowledgeError,
  isEditingKnowledge,
  editedKnowledge,
  saveKnowledgeLoading,
  saveKnowledgeError,
  setEditedKnowledge,
  setIsEditingKnowledge,
  handleSaveKnowledge,
  handleRetryKnowledge,
}) => {
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  return (
    <div className="rounded-xl border border-border/80 bg-card/70 backdrop-blur-md p-5 shadow-xs">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookOpen size={16} className="text-primary" /> Persistent Knowledge Memory (contextspace-knowledge.md)
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
                {saveKnowledgeLoading ? <Spinner className="size-3" /> : <Save size={10} />} {saveKnowledgeError ? 'Retry save' : 'Save'}
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

      {knowledgeError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{knowledgeError}</span>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void handleRetryKnowledge(ws.branchName)}
            disabled={knowledgeLoading}
          >
            <RefreshCw size={11} className={knowledgeLoading ? 'animate-spin' : ''} /> Retry load
          </Button>
        </div>
      )}

      {saveKnowledgeError && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{saveKnowledgeError}</span>
        </div>
      )}

      {isEditingKnowledge ? (
        <Textarea
          aria-label="Knowledge editor"
          className="[&_[data-slot=textarea]]:h-96 [&_[data-slot=textarea]]:resize-y [&_[data-slot=textarea]]:font-mono [&_[data-slot=textarea]]:text-xs"
          value={editedKnowledge}
          onChange={(e) => setEditedKnowledge(e.target.value)}
        />
      ) : knowledgeLoading && !knowledgeContent ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-primary" size={20} />
        </div>
      ) : !knowledgeContent ? (
        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          No knowledge file generated yet.
        </div>
      ) : viewMode === 'preview' ? (
        <div className="max-h-[550px] overflow-auto rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4">
          <ChatMarkdown content={knowledgeContent} />
        </div>
      ) : (
        <div className="max-h-[550px] overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {knowledgeContent}
        </div>
      )}
    </div>
  );
};
