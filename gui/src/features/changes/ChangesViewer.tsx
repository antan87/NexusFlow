import React, { useState } from 'react';
import { FolderGit2, RefreshCw, Check, Save, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';

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
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [diffCache, setDiffCache] = useState<Record<string, string>>({});
  const [diffLoading, setDiffLoading] = useState<Record<string, boolean>>({});
  const [diffErrors, setDiffErrors] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string>('');

  const toggleFileExpansion = async (repoName: string, fileName: string) => {
    const cacheKey = `${repoName}/${fileName}`;
    const newExpanded = !expandedFiles[cacheKey];
    setExpandedFiles((prev) => ({ ...prev, [cacheKey]: newExpanded }));

    if (newExpanded && !diffCache[cacheKey]) {
      setDiffLoading((prev) => ({ ...prev, [cacheKey]: true }));
      setDiffErrors((prev) => ({ ...prev, [cacheKey]: '' }));
      try {
        const encodedId = encodeURIComponent(ws.branchName);
        const encodedRepo = encodeURIComponent(repoName);
        const encodedFile = encodeURIComponent(fileName);
        const res = await fetch(
          `${API_BASE}/api/workspace/${encodedId}/changes/diff?repo=${encodedRepo}&file=${encodedFile}`
        );
        if (!res.ok) {
          throw new Error(`Failed to load diff: ${res.statusText}`);
        }
        const data = await res.json();
        setDiffCache((prev) => ({ ...prev, [cacheKey]: data.diff || '' }));
      } catch (err: any) {
        setDiffErrors((prev) => ({ ...prev, [cacheKey]: err.message || 'Unknown error' }));
      } finally {
        setDiffLoading((prev) => ({ ...prev, [cacheKey]: false }));
      }
    }
  };

  const renderDiffContent = (diffText: string) => {
    if (!diffText || !diffText.trim()) {
      return <div className="text-slate-500 italic p-3 font-mono text-[11px]">No diff details available.</div>;
    }
    const lines = diffText.split('\n');
    return (
      <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto p-4 rounded-xl bg-slate-950/70 border border-slate-900/80 text-slate-350 max-h-[450px] overflow-y-auto custom-scrollbar select-text">
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
    <div className="animate-fade-in">
      <header className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <FolderGit2 size={16} className="text-indigo-400" /> Active Workspace Git Diffs
        </h4>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-900 border border-slate-800/80 hover:bg-slate-850 hover:border-slate-700 rounded-xl text-[10px] font-bold transition-all cursor-pointer text-slate-300 hover:text-white"
            onClick={() => fetchGitChanges(ws.branchName)}
            disabled={gitChangesLoading}
          >
            <RefreshCw size={11} className={gitChangesLoading ? 'animate-spin text-indigo-400' : ''} /> Refresh Changes
          </button>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-900 border border-slate-800/80 hover:bg-slate-850 hover:border-indigo-500/30 hover:text-indigo-400 rounded-xl text-[10px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleSyncAll(ws.branchName)}
            disabled={syncLoading}
          >
            {syncLoading ? <RefreshCw size={11} className="animate-spin text-indigo-300" /> : <RefreshCw size={11} />} Sync All
          </button>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10"
            onClick={() => setShowCommitModal(true)}
            disabled={gitChanges.every((repo) => repo.files.length === 0) || commitLoading}
          >
            Commit & Push All
          </button>
        </div>
      </header>

      {/* Sync Results Banner */}
      {syncResults && (
        <div className="bg-indigo-500/5 border border-indigo-500/20 text-indigo-300 rounded-2xl p-5 mb-5 shadow-lg relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-indigo-500">
          <div className="flex justify-between items-center mb-3 border-b border-indigo-500/10 pb-2">
            <h5 className="font-bold text-white font-mono text-xs">Rebase / Sync Action Logs</h5>
            <button
              className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold cursor-pointer"
              onClick={() => setSyncResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {syncResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex justify-between items-center font-mono text-[10px] bg-slate-950/30 p-2 rounded-lg border border-slate-900/60"
              >
                <span className="text-slate-300 font-semibold">{r.repoName}</span>
                <span className={r.success ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {r.success ? `✓ Synced (${r.message})` : `✗ Conflict: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commit Results Banner */}
      {commitResults && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 text-emerald-300 rounded-2xl p-5 mb-5 shadow-lg relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-emerald-500">
          <div className="flex justify-between items-center mb-3 border-b border-emerald-500/10 pb-2">
            <h5 className="font-bold text-white font-mono text-xs">Commit & Push Results</h5>
            <button
              className="text-emerald-400 hover:text-emerald-300 text-[10px] font-bold cursor-pointer"
              onClick={() => setCommitResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {commitResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex justify-between items-center font-mono text-[10px] bg-slate-950/30 p-2 rounded-lg border border-slate-900/60"
              >
                <span className="text-slate-300 font-semibold">{r.repoName}</span>
                <span className={r.success ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {r.success
                    ? `✓ Committed ${r.filesChanged} file(s) (${r.commitHash ? r.commitHash.slice(0, 7) : 'no hash'})`
                    : `✗ Error: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Commit Panel */}
      {showCommitModal && (
        <div className="bg-slate-950/50 border border-slate-850 rounded-2xl p-6 mb-6 shadow-xl relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-b before:from-indigo-500/5 before:to-transparent before:pointer-events-none animate-slide-in">
          <h5 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
            <Save size={13} className="text-indigo-400" /> Enter Commit Message
          </h5>
          <input
            type="text"
            className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/35 rounded-xl px-4 py-3 text-xs font-mono text-white placeholder-slate-600 transition-all outline-none shadow-inner mb-4"
            placeholder="feat: implement multi-repo logic..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMessage.trim()) handleCommitAll(ws.branchName);
            }}
          />
          <div className="flex justify-end gap-2.5">
            <button
              className="px-4 py-2.5 bg-slate-900 border border-slate-800/80 hover:bg-slate-800 rounded-xl text-[10px] font-bold transition-all cursor-pointer text-slate-400 hover:text-white"
              onClick={() => {
                setShowCommitModal(false);
                setCommitMessage('');
              }}
              disabled={commitLoading}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2.5 bg-emerald-650 hover:bg-emerald-600 rounded-xl text-[10px] font-bold text-white transition-all cursor-pointer shadow-md shadow-emerald-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleCommitAll(ws.branchName)}
              disabled={commitLoading || !commitMessage.trim()}
            >
              {commitLoading ? 'Committing...' : 'Commit & Push All'}
            </button>
          </div>
        </div>
      )}

      {gitChangesLoading ? (
        <div className="flex justify-center py-20 animate-pulse">
          <RefreshCw className="animate-spin text-indigo-400" size={24} />
        </div>
      ) : (
        <div className="space-y-6">
          {gitChanges.every((repo) => repo.files.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 bg-slate-950/20 border border-slate-850 rounded-2xl text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 shadow-md">
                <Check size={20} />
              </div>
              <h5 className="text-sm font-bold text-white">No Uncommitted Changes</h5>
              <p className="text-xs text-slate-500 mt-1">
                Workspace repositories are completely in sync with Git feature branches.
              </p>
            </div>
          ) : (
            gitChanges.map((repo) => {
              if (repo.files.length === 0) return null;
              const totalFilesChanged = repo.files.length;
              const repoAdditions = repo.files.reduce((acc: number, f: any) => acc + (f.additions || 0), 0);
              const repoDeletions = repo.files.reduce((acc: number, f: any) => acc + (f.deletions || 0), 0);

              return (
                <div
                  key={repo.repoName}
                  className="glass-card p-6 rounded-2xl border border-slate-800/40 relative overflow-hidden transition-all duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-indigo-500/10 via-purple-500/10 to-transparent"
                >
                  <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <h5 className="text-sm font-bold text-white font-mono">{repo.repoName}</h5>
                      <span className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-slate-850 text-slate-400 font-mono font-bold uppercase tracking-wide">
                        {totalFilesChanged} file{totalFilesChanged === 1 ? '' : 's'} changed
                      </span>
                      {(repoAdditions > 0 || repoDeletions > 0) && (
                        <span className="text-[10px] font-mono font-bold bg-slate-950/40 border border-slate-900/60 px-2 py-0.5 rounded">
                          <span className="text-emerald-400 font-bold">+{repoAdditions}</span>{' '}
                          <span className="text-rose-400 font-bold">-{repoDeletions}</span>
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] text-slate-500 font-mono truncate max-w-[280px]"
                      title={repo.repoPath}
                    >
                      {repo.repoPath}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {repo.files.map((fileInfo: any) => {
                      const cacheKey = `${repo.repoName}/${fileInfo.file}`;
                      const isExpanded = !!expandedFiles[cacheKey];
                      const isLoading = !!diffLoading[cacheKey];
                      const fileDiff = diffCache[cacheKey] || '';
                      const error = diffErrors[cacheKey] || '';

                      return (
                        <div
                          key={fileInfo.file}
                          className="border border-slate-900 rounded-xl overflow-hidden bg-slate-950/20 hover:border-slate-800/80 transition-all duration-200"
                        >
                          {/* File Header Row */}
                          <div
                            className="flex justify-between items-center px-4 py-3 cursor-pointer select-none hover:bg-slate-900/40 transition-colors"
                            onClick={() => toggleFileExpansion(repo.repoName, fileInfo.file)}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {isExpanded ? (
                                <ChevronDown size={14} className="text-indigo-400 shrink-0" />
                              ) : (
                                <ChevronRight size={14} className="text-slate-500 shrink-0" />
                              )}
                              <span
                                className="font-mono text-slate-300 hover:text-white text-[11px] truncate max-w-[240px] sm:max-w-[480px]"
                                title={fileInfo.file}
                              >
                                {fileInfo.file}
                              </span>
                              {(fileInfo.additions > 0 || fileInfo.deletions > 0) && (
                                <span className="text-[9px] font-mono font-bold text-slate-500 shrink-0 ml-1">
                                  <span className="text-emerald-500">+{fileInfo.additions}</span> /{' '}
                                  <span className="text-rose-500">-{fileInfo.deletions}</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <span
                                className={`text-[8px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                                  fileInfo.type === 'added'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : fileInfo.type === 'deleted'
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                              >
                                {fileInfo.type}
                              </span>
                            </div>
                          </div>

                          {/* Diff Details Section */}
                          {isExpanded && (
                            <div className="border-t border-slate-900/60 p-3 bg-slate-950/40">
                              {isLoading ? (
                                <div className="flex items-center gap-2 text-[10px] text-indigo-400 p-2 font-mono">
                                  <RefreshCw size={12} className="animate-spin" /> Loading diff...
                                </div>
                              ) : error ? (
                                <div className="text-rose-400 text-[10px] p-2 font-mono">Error: {error}</div>
                              ) : (
                                <div className="relative">
                                  {/* Copy Button */}
                                  <div className="absolute top-2 right-2 z-10">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(fileDiff);
                                        setCopiedKey(cacheKey);
                                        setTimeout(() => setCopiedKey(''), 2000);
                                      }}
                                      className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer shadow-md"
                                      title="Copy Diff"
                                    >
                                      {copiedKey === cacheKey ? (
                                        <Check size={12} className="text-emerald-400" />
                                      ) : (
                                        <Copy size={12} />
                                      )}
                                    </button>
                                  </div>
                                  {renderDiffContent(fileDiff)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
