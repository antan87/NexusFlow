import React, { useState } from 'react';
import { ListOrdered, RefreshCw, FileText, Code } from 'lucide-react';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Button } from '../../components/ui/button.js';

interface ImplementationPlanProps {
  planContent: string;
  planLoading: boolean;
}

export const ImplementationPlan: React.FC<ImplementationPlanProps> = ({
  planContent,
  planLoading,
}) => {
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  return (
    <div className="rounded-lg border border-border bg-card p-4 surface-card">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ListOrdered size={16} className="text-primary" /> Inter-Repo Implementation Plan (nexusflow-plan.md)
        </h4>
        {planContent && (
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
      </header>

      {planLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-primary" size={20} />
        </div>
      ) : !planContent ? (
        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          No implementation plan generated yet.
        </div>
      ) : viewMode === 'preview' ? (
        <div data-vim-scroll className="max-h-[500px] overflow-auto rounded-md border border-border/70 bg-muted/20 p-4">
          <ChatMarkdown content={planContent} />
        </div>
      ) : (
        <div data-vim-scroll className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {planContent}
        </div>
      )}
    </div>
  );
};
