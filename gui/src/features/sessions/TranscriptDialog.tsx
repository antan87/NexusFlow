import { Copy, Play, RefreshCw, X } from 'lucide-react';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import type { Feature } from '../../types.js';

interface TranscriptDialogProps {
  activeSession: any;
  transcript: any[];
  transcriptLoading: boolean;
  setActiveSession: (session: any | null) => void;
  workspaces: Feature[];
  handleResumeSession: (ws: Feature, sessionId?: string, assistant?: string) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function TranscriptDialog({
  activeSession,
  transcript,
  transcriptLoading,
  setActiveSession,
  workspaces,
  handleResumeSession,
  showToast,
}: TranscriptDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-surface border border-gray-800 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/40">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                activeSession.assistant === 'antigravity' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
                activeSession.assistant === 'claude' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                activeSession.assistant === 'codex' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              }`}>
                {activeSession.assistant === 'antigravity' ? 'Antigravity' :
                 activeSession.assistant === 'claude' ? 'Claude Code' :
                 activeSession.assistant === 'codex' ? 'OpenAI Codex' : 'GitHub Copilot'}
              </span>
              <span className="text-[10px] text-gray-500">Session: {activeSession.id}</span>
            </div>
            <h3 className="text-sm font-bold text-white truncate max-w-xl" title={activeSession.title}>
              {activeSession.title}
            </h3>
          </div>
          <button
            className="text-gray-400 hover:text-white p-2 hover:bg-gray-800/80 rounded-lg transition-colors cursor-pointer"
            onClick={() => setActiveSession(null)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body / Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-950/10">
          {transcriptLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <RefreshCw className="animate-spin text-indigo-400" size={24} />
              <span className="text-xs text-gray-500 font-medium">Loading conversation history...</span>
            </div>
          ) : transcript.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-gray-500">
              No messages found in this transcript.
            </div>
          ) : (
            transcript.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className="text-[10px] text-gray-500 mb-1 px-1">
                  {msg.role === 'user' ? 'Developer' : activeSession.assistant === 'antigravity' ? 'Antigravity' : activeSession.assistant === 'claude' ? 'Claude' : activeSession.assistant === 'codex' ? 'Codex' : 'Copilot'}
                  {msg.timestamp && ` • ${new Date(msg.timestamp).toLocaleTimeString()}`}
                </div>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-650 text-white rounded-tr-none shadow-md border border-indigo-500/10'
                    : 'bg-gray-900 border border-gray-800 text-gray-200 rounded-tl-none shadow-sm font-sans'
                }`}>
                  <ChatMarkdown content={msg.content} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/40 flex justify-between items-center">
          <span className="text-[11px] text-gray-550">
            Resuming will copy the shell command and open your code editor.
          </span>
          <div className="flex gap-2">
            <button
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 border border-gray-800 hover:bg-gray-800 rounded-lg text-xs font-bold text-white transition-all cursor-pointer"
              onClick={() => {
                const cmd = activeSession.assistant === 'antigravity' ? `agy --conversation ${activeSession.id}` :
                            activeSession.assistant === 'claude' ? `claude --resume ${activeSession.id}` :
                            activeSession.assistant === 'codex' ? `codex resume ${activeSession.id}` :
                            `copilot --resume ${activeSession.id}`;
                navigator.clipboard.writeText(cmd);
                showToast(`Copied run command to clipboard:\n\n${cmd}`, 'success');
              }}
            >
              <Copy size={13} /> Copy Resume Command
            </button>
            <button
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              onClick={() => {
                const ws = workspaces.find(w => w.branchName === activeSession.workspacePath.split(/[\\/]/).pop());
                handleResumeSession(ws || workspaces[0], activeSession.id, activeSession.assistant);
                setActiveSession(null);
              }}
            >
              <Play size={12} /> Resume Conversation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
