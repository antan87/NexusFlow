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
    <div className="bg-[#090d1a]/20 border border-gray-800/60 rounded-xl p-4">
      <header className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <ListOrdered size={16} className="text-cyan-400" /> Inter-Repo Implementation Plan (nexusflow-plan.md)
        </h4>
      </header>

      {planLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-indigo-400" size={20} />
        </div>
      ) : (
        <div className="bg-gray-950/40 border border-gray-800/30 rounded-xl p-4 text-gray-350 text-xs leading-relaxed overflow-auto font-mono whitespace-pre-wrap max-h-96">
          {planContent || "No implementation plan generated yet."}
        </div>
      )}
    </div>
  );
};
