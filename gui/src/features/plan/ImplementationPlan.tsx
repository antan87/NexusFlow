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
    <div className="rounded-xl border border-border/80 bg-card/70 backdrop-blur-md p-5 shadow-xs">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ListOrdered size={16} className="text-primary" /> Inter-Repo Implementation Plan (contextspace-plan.md)
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
        <div className="max-h-[550px] overflow-auto rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4">
          <ChatMarkdown content={planContent} />
        </div>
      ) : (
        <div className="max-h-[550px] overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {planContent}
        </div>
      )}
    </div>
  );
};
