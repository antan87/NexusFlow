import React from 'react';
import { FolderGit2, RefreshCw, Check } from 'lucide-react';
import type { Feature } from '../../types.js';

interface ChangesViewerProps {
  ws: Feature;
  gitChanges: any[];
  gitChangesLoading: boolean;
  syncLoading: boolean;
  syncResults: any[] | null;
  commitMessage: string;
  showCommitModal: boolean;
  commitLoading: boolean;
  commitResults: any[] | null;
  setSyncResults: (val: any[] | null) => void;
  setCommitResults: (val: any[] | null) => void;
  setCommitMessage: (val: string) => void;
  setShowCommitModal: (val: boolean) => void;
  fetchGitChanges: (wsId: string) => Promise<void>;
  handleSyncAll: (wsId: string) => Promise<void>;
  handleCommitAll: (wsId: string) => Promise<void>;
}

export const ChangesViewer: React.FC<ChangesViewerProps> = ({
  ws,
  gitChanges,
  gitChangesLoading,
  syncLoading,
  syncResults,
  commitMessage,
  showCommitModal,
  commitLoading,
  commitResults,
  setSyncResults,
  setCommitResults,
  setCommitMessage,
  setShowCommitModal,
  fetchGitChanges,
  handleSyncAll,
  handleCommitAll,
}) => {
  return (
    <div>
      <header className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <FolderGit2 size={16} className="text-cyan-400" /> Active Workspace Git Diffs
        </h4>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 border border-gray-800 hover:bg-gray-800 hover:border-gray-700 rounded-lg text-[10px] font-semibold transition-all cursor-pointer text-gray-300"
            onClick={() => fetchGitChanges(ws.branchName)}
            disabled={gitChangesLoading}
          >
            <RefreshCw size={11} className={gitChangesLoading ? 'animate-spin text-indigo-400' : ''} /> Refresh Changes
          </button>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleSyncAll(ws.branchName)}
            disabled={syncLoading}
          >
            {syncLoading ? <RefreshCw size={11} className="animate-spin text-indigo-300" /> : <RefreshCw size={11} />} Sync All
          </button>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setShowCommitModal(true)}
            disabled={gitChanges.every(repo => repo.files.length === 0) || commitLoading}
          >
            Commit & Push All
          </button>
        </div>
      </header>

      {syncResults && (
        <div className="bg-[#090d1a]/60 border border-gray-800 rounded-xl p-4 mb-4 text-xs">
          <div className="flex justify-between items-center mb-2 border-b border-gray-800/80 pb-2">
            <h5 className="font-bold text-white font-mono text-[11px]">Rebase/Sync Results</h5>
            <button className="text-gray-500 hover:text-gray-300 text-[10px] cursor-pointer" onClick={() => setSyncResults(null)}>Dismiss</button>
          </div>
          <div className="space-y-1.5">
            {syncResults.map((r: any) => (
              <div key={r.repoName} className="flex justify-between items-center font-mono text-[10px]">
                <span className="text-gray-300">{r.repoName}</span>
                <span className={r.success ? "text-emerald-400" : "text-rose-400"}>
                  {r.success ? `✅ Synced (${r.message})` : `⚠️ Conflict: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {commitResults && (
        <div className="bg-[#090d1a]/60 border border-gray-800 rounded-xl p-4 mb-4 text-xs">
          <div className="flex justify-between items-center mb-2 border-b border-gray-800/80 pb-2">
            <h5 className="font-bold text-white font-mono text-[11px]">Commit/Push Results</h5>
            <button className="text-gray-500 hover:text-gray-300 text-[10px] cursor-pointer" onClick={() => setCommitResults(null)}>Dismiss</button>
          </div>
          <div className="space-y-1.5">
            {commitResults.map((r: any) => (
              <div key={r.repoName} className="flex justify-between items-center font-mono text-[10px]">
                <span className="text-gray-300">{r.repoName}</span>
                <span className={r.success ? "text-emerald-400" : "text-rose-400"}>
                  {r.success ? `✅ Committed ${r.filesChanged} file(s) (${r.commitHash || 'no hash'})` : `⚠️ Error: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCommitModal && (
        <div className="bg-[#0b0f19] border border-gray-800 rounded-xl p-4 mb-4">
          <h5 className="text-xs font-bold text-white mb-2">Enter Commit Message</h5>
          <input
            type="text"
            className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-gray-350 focus:outline-none focus:border-indigo-500 mb-3"
            placeholder="feat: implement logic..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitAll(ws.branchName);
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 bg-gray-900 border border-gray-800 hover:bg-gray-850 rounded-lg text-[10px] font-semibold transition-all cursor-pointer text-gray-400"
              onClick={() => {
                setShowCommitModal(false);
                setCommitMessage('');
              }}
              disabled={commitLoading}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-[10px] font-semibold text-white transition-all cursor-pointer"
              onClick={() => handleCommitAll(ws.branchName)}
              disabled={commitLoading || !commitMessage.trim()}
            >
              {commitLoading ? 'Committing...' : 'Commit & Push'}
            </button>
          </div>
        </div>
      )}

      {gitChangesLoading ? (
        <div className="flex justify-center py-10">
          <RefreshCw className="animate-spin text-indigo-400" size={20} />
        </div>
      ) : (
        <div className="space-y-4">
          {gitChanges.every(repo => repo.files.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-12 bg-gray-950/20 border border-gray-800/40 rounded-xl text-center">
              <Check size={28} className="text-emerald-500 mb-2" />
              <h5 className="text-xs font-bold text-white">No Uncommitted Changes</h5>
              <p className="text-[10px] text-gray-500 mt-0.5">Workspace is completely synced with Git feature branches.</p>
            </div>
          ) : (
            gitChanges.map((repo) => {
              if (repo.files.length === 0) return null;
              const totalFilesChanged = repo.files.length;
              const repoAdditions = repo.files.reduce((acc: number, f: any) => acc + (f.additions || 0), 0);
              const repoDeletions = repo.files.reduce((acc: number, f: any) => acc + (f.deletions || 0), 0);

              return (
                <div key={repo.repoName} className="bg-gray-950/20 border border-gray-800/60 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <h5 className="text-xs font-bold text-white font-mono">{repo.repoName}</h5>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400 font-mono">
                        {totalFilesChanged} file{totalFilesChanged === 1 ? '' : 's'} changed
                      </span>
                      {(repoAdditions > 0 || repoDeletions > 0) && (
                        <span className="text-[9px] font-mono">
                          <span className="text-emerald-400 font-bold">+{repoAdditions}</span>{' '}
                          <span className="text-rose-400 font-bold">-{repoDeletions}</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-gray-500 font-mono truncate max-w-[280px]">{repo.repoPath}</span>
                  </div>
                  <div className="space-y-1.5">
                    {repo.files.map((fileInfo: any) => (
                      <div key={fileInfo.file} className="flex justify-between items-center bg-[#090d1a]/40 px-3 py-2 rounded-lg border border-gray-800/30 text-xs">
                        <div className="flex flex-col min-w-0">
                          <span className="font-mono text-gray-300 text-[11px] truncate max-w-[320px]">{fileInfo.file}</span>
                          {(fileInfo.additions > 0 || fileInfo.deletions > 0) && (
                            <span className="text-[9px] font-mono mt-0.5">
                              <span className="text-emerald-500">+{fileInfo.additions}</span>{' '}
                              <span className="text-rose-500">-{fileInfo.deletions}</span>
                            </span>
                          )}
                        </div>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                          fileInfo.type === 'added' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          fileInfo.type === 'deleted' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {fileInfo.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
