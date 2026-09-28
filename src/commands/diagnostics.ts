import { resolveWorkspaceQuiet } from '../utils/resolve-workspace.js';
import { getDataGuide, renderDataGuide } from '../core/data-guide.js';
import {
  collectDiagnostics, previewDiagnostics, readDiagnosticCandidate, reviewedDiagnostics,
  saveDiagnosticFile, DiagnosticError,
} from '../core/diagnostics.js';

async function workspaceForDiagnostics(workspace?: string): Promise<string | undefined> {
  try { return (await resolveWorkspaceQuiet(workspace)) ?? undefined; }
  catch { throw new DiagnosticError('Workspace unavailable. Choose an existing ContextSpace workspace.'); }
}

export async function dataGuideCommand(options: { json?: boolean }): Promise<void> {
  console.log(options.json ? JSON.stringify(getDataGuide(), null, 2) : renderDataGuide());
}

export async function diagnosticPreviewCommand(workspace: string | undefined, options: { candidate?: string; omit?: string[] }): Promise<void> {
  const collected = await collectDiagnostics(await workspaceForDiagnostics(workspace));
  const preview = previewDiagnostics(collected.report, options.omit ?? []);
  if (options.candidate) await saveDiagnosticFile(options.candidate, preview.content);
  // JSON on stdout is the exact review envelope; no banner or raw error details.
  console.log(JSON.stringify(preview, null, 2));
}

export async function diagnosticExportCommand(candidate: string, options: { digest: string; output: string }): Promise<void> {
  const preview = reviewedDiagnostics(await readDiagnosticCandidate(candidate), options.digest);
  await saveDiagnosticFile(options.output, preview.content);
  console.log(JSON.stringify({ saved: true, digest: preview.digest }));
}
