import React from 'react';
import { Check, X, Send } from 'lucide-react';
import { Button } from '../../components/ui/index.js';

interface DiffPanelProps {
  diffText: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  disabled?: boolean;
}

export const DiffPanel: React.FC<DiffPanelProps> = ({ diffText, onApprove, onReject, disabled }) => {
  const [feedback, setFeedback] = React.useState('');
  const [isRejecting, setIsRejecting] = React.useState(false);

  const renderDiffContent = (diff: string) => {
    if (!diff || !diff.trim()) {
      return <div className="text-slate-500 italic p-3 font-mono text-[11px]">No diff details available.</div>;
    }
    const lines = diff.split('\n');
    return (
      <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto p-4 rounded-xl bg-slate-950/70 border border-slate-900/80 text-slate-350 max-h-[300px] overflow-y-auto custom-scrollbar select-text">
        {lines.map((line, idx) => {
          let lineClass: string;
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass = 'text-emerald-400 bg-emerald-500/5 px-1 rounded-sm block w-full';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass = 'text-rose-400 bg-rose-500/5 px-1 rounded-sm block w-full';
          } else if (line.startsWith('@@')) {
            lineClass = 'text-indigo-400/85 font-semibold italic bg-indigo-500/5 px-1 block w-full';
          } else if (
            line.startsWith('diff') ||
            line.startsWith('index') ||
            line.startsWith('---') ||
            line.startsWith('+++')
          ) {
            lineClass = 'text-slate-500 font-bold block w-full';
          } else {
            lineClass = 'text-slate-350 px-1 block w-full';
          }
          return (
            <code key={idx} className={lineClass}>
              {line}
            </code>
          );
        })}
      </pre>
    );
  };

  return (
    <div className="flex flex-col gap-3 my-2 border border-slate-800 bg-surface/50 rounded-xl p-3 shadow-sm">
      <div className="text-xs font-semibold text-content mb-1">Agent Proposed Changes:</div>
      {renderDiffContent(diffText)}
      
      {!isRejecting ? (
        <div className="flex gap-2 justify-end mt-2">
          <Button
            variant="secondary"
            icon={<X size={14} className="text-rose-400" />}
            onClick={() => setIsRejecting(true)}
            disabled={disabled}
            className="text-rose-400 border-rose-500/20 hover:bg-rose-500/10"
          >
            Reject / Add Feedback
          </Button>
          <Button
            variant="primary"
            icon={<Check size={14} />}
            onClick={onApprove}
            disabled={disabled}
            className="bg-emerald-600 hover:bg-emerald-500 border-emerald-500/20 shadow-emerald-500/10"
          >
            Approve & Apply
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          <textarea
            className="w-full bg-slate-950/60 border border-slate-800 focus:border-rose-500/80 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-600 resize-none outline-none"
            rows={3}
            placeholder="Why are you rejecting this? E.g., 'The variable name should be xyz instead...'"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={disabled}
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              onClick={() => setIsRejecting(false)}
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Send size={12} className="text-white" />}
              onClick={() => onReject(feedback)}
              disabled={disabled || !feedback.trim()}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              Send Feedback
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
