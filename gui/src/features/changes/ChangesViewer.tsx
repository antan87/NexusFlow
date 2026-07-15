import React, { useState } from 'react';
import { FolderGit2, RefreshCw, Check, Save, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';

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
      return <div className="p-3 font-mono text-[11px] italic text-muted-foreground">No diff details available.</div>;
    }
    const lines = diffText.split('\n');
    return (
      <pre className="custom-scrollbar max-h-[450px] overflow-x-auto overflow-y-auto rounded-xl border border-border bg-muted/40 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
        {lines.map((line, idx) => {
          let lineClass: string;
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass = 'block w-full rounded-sm bg-success/10 px-1 text-success-foreground';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass = 'block w-full rounded-sm bg-destructive/10 px-1 text-destructive-foreground';
          } else if (line.startsWith('@@')) {
            lineClass = 'block w-full bg-info/10 px-1 font-semibold italic text-info-foreground';
          } else if (
            line.startsWith('diff') ||
            line.startsWith('index') ||
            line.startsWith('---') ||
            line.startsWith('+++')
          ) {
            lineClass = 'block w-full font-bold text-muted-foreground';
          } else {
            lineClass = 'block w-full px-1 text-foreground';
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
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <FolderGit2 size={16} className="text-primary" /> Active Workspace Git Diffs
        </h4>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchGitChanges(ws.branchName)}
            disabled={gitChangesLoading}
          >
            <RefreshCw size={11} className={gitChangesLoading ? 'animate-spin text-primary' : ''} /> Refresh Changes
          </Button>
          {ws.mode !== 'in-place' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSyncAll(ws.branchName)}
              disabled={syncLoading}
            >
              {syncLoading ? <Spinner className="size-3" /> : <RefreshCw size={11} />} Sync All
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setShowCommitModal(true)}
            disabled={gitChanges.every((repo) => repo.files.length === 0) || commitLoading}
          >
            Commit & Push All
          </Button>
        </div>
      </header>

      {/* Sync Results Banner */}
      {syncResults && ws.mode !== 'in-place' && (
        <div className="relative mb-5 rounded-xl border border-info/25 bg-info/10 p-5 text-info-foreground shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-info/20 pb-2">
            <h5 className="font-mono text-xs font-bold text-foreground">Rebase / Sync Action Logs</h5>
            <button
              className="cursor-pointer text-[10px] font-bold text-info-foreground hover:text-foreground"
              onClick={() => setSyncResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {syncResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-2 font-mono text-[10px]"
              >
                <span className="font-semibold text-foreground">{r.repoName}</span>
                <span className={r.success ? 'font-bold text-success-foreground' : 'font-bold text-destructive-foreground'}>
                  {r.success ? `✓ Synced (${r.message})` : `✗ Conflict: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commit Results Banner */}
      {commitResults && (
        <div className="relative mb-5 rounded-xl border border-success/25 bg-success/10 p-5 text-success-foreground shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-success/20 pb-2">
            <h5 className="font-mono text-xs font-bold text-foreground">Commit & Push Results</h5>
            <button
              className="cursor-pointer text-[10px] font-bold text-success-foreground hover:text-foreground"
              onClick={() => setCommitResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {commitResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-2 font-mono text-[10px]"
              >
                <span className="font-semibold text-foreground">{r.repoName}</span>
                <span className={r.success ? 'font-bold text-success-foreground' : 'font-bold text-destructive-foreground'}>
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
        <div className="relative mb-6 rounded-xl border border-border bg-card p-6 shadow-sm animate-slide-in">
          <h5 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Save size={13} className="text-primary" /> Enter Commit Message
          </h5>
          <Input
            type="text"
            className="mb-4 font-mono text-xs"
            placeholder="feat: implement multi-repo logic..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMessage.trim()) handleCommitAll(ws.branchName);
            }}
          />
          <div className="flex justify-end gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCommitModal(false);
                setCommitMessage('');
              }}
              disabled={commitLoading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleCommitAll(ws.branchName)}
              disabled={commitLoading || !commitMessage.trim()}
            >
              {commitLoading ? <Spinner className="size-3" /> : null}
              {commitLoading ? 'Committing...' : 'Commit & Push All'}
            </Button>
          </div>
        </div>
      )}

      {gitChangesLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6 text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {gitChanges.every((repo) => repo.files.length === 0) ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-success/25 bg-success/10 text-success-foreground shadow-sm">
                <Check size={20} />
              </div>
              <h5 className="text-sm font-bold text-foreground">No Uncommitted Changes</h5>
              <p className="mt-1 text-xs text-muted-foreground">
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
                  className="relative rounded-xl border border-border bg-card p-6 transition-colors"
                >
                  <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <h5 className="font-mono text-sm font-bold text-foreground">{repo.repoName}</h5>
                      <StatusBadge tone="warning" dot={false}>
                        {totalFilesChanged} file{totalFilesChanged === 1 ? '' : 's'} changed
                      </StatusBadge>
                      {(repoAdditions > 0 || repoDeletions > 0) && (
                        <span className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] font-bold">
                          <span className="font-bold text-success-foreground">+{repoAdditions}</span>{' '}
                          <span className="font-bold text-destructive-foreground">-{repoDeletions}</span>
                        </span>
                      )}
                    </div>
                    <span
                      className="max-w-[280px] truncate font-mono text-[10px] text-muted-foreground"
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
                          className="overflow-hidden rounded-xl border border-border bg-muted/20 transition-colors hover:border-foreground/15"
                        >
                          {/* File Header Row */}
                          <div
                            className="flex cursor-pointer select-none items-center justify-between px-4 py-3 transition-colors hover:bg-accent/50"
                            onClick={() => toggleFileExpansion(repo.repoName, fileInfo.file)}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {isExpanded ? (
                                <ChevronDown size={14} className="shrink-0 text-primary" />
                              ) : (
                                <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                              )}
                              <span
                                className="max-w-[240px] truncate font-mono text-[11px] text-foreground sm:max-w-[480px]"
                                title={fileInfo.file}
                              >
                                {fileInfo.file}
                              </span>
                              {(fileInfo.additions > 0 || fileInfo.deletions > 0) && (
                                <span className="ml-1 shrink-0 font-mono text-[9px] font-bold text-muted-foreground">
                                  <span className="text-success-foreground">+{fileInfo.additions}</span> /{' '}
                                  <span className="text-destructive-foreground">-{fileInfo.deletions}</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <span
                                className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                                  fileInfo.type === 'added'
                                    ? 'border-success/25 bg-success/10 text-success-foreground'
                                    : fileInfo.type === 'deleted'
                                      ? 'border-destructive/25 bg-destructive/10 text-destructive-foreground'
                                      : 'border-warning/25 bg-warning/10 text-warning-foreground'
                                }`}
                              >
                                {fileInfo.type}
                              </span>
                            </div>
                          </div>

                          {/* Diff Details Section */}
                          {isExpanded && (
                            <div className="border-t border-border bg-background p-3">
                              {isLoading ? (
                                <div className="flex items-center gap-2 p-2 font-mono text-[10px] text-primary">
                                  <Spinner className="size-3" /> Loading diff...
                                </div>
                              ) : error ? (
                                <div className="p-2 font-mono text-[10px] text-destructive-foreground">Error: {error}</div>
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
                                      className="cursor-pointer rounded-lg border border-border bg-card p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
                                      title="Copy Diff"
                                    >
                                      {copiedKey === cacheKey ? (
                                        <Check size={12} className="text-success-foreground" />
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
