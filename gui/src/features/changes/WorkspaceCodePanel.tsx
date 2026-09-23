import { useEffect, useRef, useState } from 'react';
import { FileCode, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/api/client.js';
import { Button } from '../../components/ui/button.js';
import { FileTree } from './FileTree.js';
import { DiffErrorBoundary } from './DiffErrorBoundary.js';
import { PluggableDiffViewer } from './PluggableDiffViewer.js';
import { resolveFileReference } from './resolveFileReference.js';

interface CodeFile { file: string; type: string; additions?: number; deletions?: number }
interface CodeRepo { repoName: string; repoPath: string; files: CodeFile[]; error?: string }
interface Selection { repoName: string; repoPath: string; file: string; line?: number }
interface FileDiff { diff: string; fileContent?: string; originalContent?: string }

export function WorkspaceCodePanel({ workspace, active, openReference }: { workspace: string; active: boolean; openReference?: { path: string; line?: number; id: number } | null }) {
  const [mode, setMode] = useState<'changes' | 'files'>('changes');
  const [repos, setRepos] = useState<CodeRepo[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const handledReference = useRef(0);
  const plainCode = useRef<HTMLPreElement>(null);
  const scrolledSelection = useRef<Selection | null>(null);
  const base = `/api/workspace/${encodeURIComponent(workspace)}`;

  useEffect(() => { if (openReference && openReference.id !== handledReference.current) setMode('files'); }, [openReference]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true); setError('');
    void apiFetch<{ changes: CodeRepo[] }>(`${base}/changes${mode === 'files' ? '?include=all' : ''}`).then(result => {
      if (cancelled) return;
      setRepos(result.changes);
      if (mode === 'files' && openReference && openReference.id !== handledReference.current) {
        handledReference.current = openReference.id;
        const resolved = resolveFileReference(openReference.path, result.changes);
        setReferenceError(resolved.error ?? '');
        setDiff(null);
        setSelection(resolved.file ? { ...resolved.file, line: openReference.line } : null);
      } else {
        setSelection(current => current && result.changes.some(repo => repo.repoName === current.repoName && repo.files.some(file => file.file === current.file)) ? current : null);
      }
    }).catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base, mode, revision, active, openReference]);

  useEffect(() => {
    if (!active || !selection) { setDiff(null); return; }
    let cancelled = false;
    setDiffError('');
    const query = new URLSearchParams({ repo: selection.repoName, file: selection.file });
    void apiFetch<FileDiff>(`${base}/changes/diff?${query}`).then(result => { if (!cancelled) setDiff(result); })
      .catch(e => { if (!cancelled) setDiffError((e as Error).message); });
    return () => { cancelled = true; };
  }, [base, selection, revision, active]);

  useEffect(() => {
    if (!selection?.line || !diff || diff.diff || !plainCode.current || scrolledSelection.current === selection) return;
    scrolledSelection.current = selection;
    const lineHeight = Number.parseFloat(getComputedStyle(plainCode.current).lineHeight) || 16;
    plainCode.current.parentElement?.scrollTo({ top: Math.max(0, (selection.line - 1) * lineHeight - 32) });
  }, [selection, diff]);

  return <section aria-label="Workspace code" className="flex h-full min-h-0 min-w-0 flex-col bg-background">
    <div className="flex items-center gap-1 border-b border-border p-2">
      <Button size="xs" variant={mode === 'changes' ? 'secondary' : 'ghost'} aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>Changes</Button>
      <Button size="xs" variant={mode === 'files' ? 'secondary' : 'ghost'} aria-pressed={mode === 'files'} onClick={() => setMode('files')}>Files</Button>
      <Button size="xs" variant="ghost" aria-label="Refresh code" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw className="size-3" /></Button>
      <span className="ml-auto text-xs text-muted-foreground">{loading ? 'Refreshing…' : `${repos.reduce((sum, repo) => sum + repo.files.length, 0)} files`}</span>
    </div>
    {error && <p role="alert" className="p-2 text-xs text-destructive">{error} <button className="underline" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {referenceError && <p role="alert" className="p-2 text-xs text-destructive">{referenceError}</p>}
    <div className="max-h-[40%] min-h-20 overflow-auto border-b border-border p-2">
      {repos.map(repo => <details open key={repo.repoName}>
        <summary className="cursor-pointer py-1 text-xs font-semibold">{repo.repoName}</summary>
        {repo.error ? <p role="alert" className="text-xs text-destructive">{repo.error}</p> : <FileTree label={`${repo.repoName} ${mode}`} files={repo.files} revealPath={selection?.repoName === repo.repoName ? selection.file : undefined} renderFile={file => <button
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
          aria-pressed={selection?.repoName === repo.repoName && selection.file === file.file}
          title={file.file} onClick={() => { setReferenceError(''); setDiff(null); setSelection({ repoName: repo.repoName, repoPath: repo.repoPath, file: file.file }); }}>
          <FileCode className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{file.file.split('/').at(-1)}</span>
          {file.type !== 'unchanged' && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{file.type}</span>}
        </button>} />}
      </details>)}
      {!loading && !error && !repos.some(repo => repo.files.length || repo.error) && <p className="p-2 text-xs text-muted-foreground">{mode === 'changes' ? 'No uncommitted changes.' : 'No repository files.'}</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {!selection ? <p className="p-3 text-xs text-muted-foreground">Select a file to inspect its code and changes alongside the CLI chat.</p>
        : <><p className="break-all border-b border-border p-2 font-mono text-xs">{selection.repoName}/{selection.file}{selection.line ? `:${selection.line}` : ''}</p>
          {diffError ? <p role="alert" className="p-3 text-xs text-destructive">{diffError} <button className="underline" onClick={() => setRevision(value => value + 1)}>Retry</button></p>
            : !diff ? <p role="status" className="p-3 text-xs">Loading file…</p>
              : diff.diff ? <DiffErrorBoundary key={`${workspace}/${selection.repoName}/${selection.file}`}><PluggableDiffViewer filePath={selection.file} repoName={selection.repoName} repoPath={selection.repoPath} patchText={diff.diff} fullFileContent={diff.fileContent} fullOriginalContent={diff.originalContent} initialTargetLine={selection.line} viewMode="unified" /></DiffErrorBoundary>
                : <pre ref={plainCode} className="p-3 font-mono text-xs whitespace-pre">{diff.fileContent || 'Empty file or no text content.'}</pre>}
        </>}
    </div>
  </section>;
}
