import React from 'react';
import { ListOrdered, RefreshCw } from 'lucide-react';

interface ImplementationPlanProps {
  planContent: string;
  planLoading: boolean;
}

export const ImplementationPlan: React.FC<ImplementationPlanProps> = ({
  planContent,
  planLoading,
}) => {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <header className="flex justify-between items-center mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ListOrdered size={16} className="text-info" /> Inter-Repo Implementation Plan (nexusflow-plan.md)
        </h4>
      </header>

      {planLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-primary" size={20} />
        </div>
      ) : (
        <div className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {planContent || "No implementation plan generated yet."}
        </div>
      )}
    </div>
  );
};
