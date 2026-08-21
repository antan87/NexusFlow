/**
 * Server-owned workspace launch catalog.
 *
 * The renderer selects a stable id. It never supplies an executable, URI, or
 * filesystem path, which keeps process construction on this trusted boundary.
 */

import { execa } from 'execa';
import * as path from 'node:path';

import type {
  Feature,
  WorkspaceLaunchIcon,
  WorkspaceLaunchTarget,
  WorkspaceLaunchTargetKind,
} from '../types.js';
import { isValidSessionUuid } from '../agent/session.js';
import { detectEditors } from './detect-editors.js';
import { openInEditor } from './open-editor.js';

interface EditorDefinition {
  id: string;
  name: string;
  command: string;
  icon: WorkspaceLaunchIcon;
  description: string;
}

interface DesktopDefinition {
  id: string;
  name: string;
  scheme: 'codex' | 'claude';
  icon: WorkspaceLaunchIcon;
  description: string;
  macAppNames: string[];
  buildNewUri(workspacePath: string, prompt?: string): string;
  buildResumeUri?(sessionId: string): string;
}

export type WorkspaceLaunchIntent =
  | { kind: 'new-workspace'; prompt?: string }
  | { kind: 'resume-session'; sessionId: string };

const DESKTOP_PROMPT_MAX_LENGTH = 1_600;
const WINDOWS_DESKTOP_URI_ENV = 'NEXUSFLOW_DESKTOP_URI';
const WINDOWS_DESKTOP_URI_COMMAND = `start "" "%${WINDOWS_DESKTOP_URI_ENV}%"`;
const DEFAULT_WORKSPACE_PROMPT =
  'Read the workspace instructions and implementation plan, inspect the repository state, then begin the task described for this workspace. Ask before making a decision that materially changes scope.';

function truncateWellFormed(value: string, maxCodeUnits: number): string {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const safeCharacter = codePoint >= 0xD800 && codePoint <= 0xDFFF ? '\uFFFD' : character;
    if (result.length + safeCharacter.length > maxCodeUnits) break;
    result += safeCharacter;
  }
  return result;
}

/** Build a concise, server-owned kickoff for a provider Desktop composer. */
export function buildWorkspaceLaunchPrompt(feature: Pick<Feature, 'description'>): string {
  const description = feature.description?.trim();
  if (!description) return DEFAULT_WORKSPACE_PROMPT;

  const prefix = `${DEFAULT_WORKSPACE_PROMPT}\n\nWorkspace task: `;
  const remaining = Math.max(0, DESKTOP_PROMPT_MAX_LENGTH - prefix.length);
  return `${prefix}${truncateWellFormed(description, remaining)}`;
}

const DESKTOP_TARGETS: readonly DesktopDefinition[] = [
  {
    id: 'codex-desktop',
    name: 'Codex Desktop',
    scheme: 'codex',
    icon: 'codex',
    description: 'Start a new Codex chat with this folder as its workspace.',
    macAppNames: ['Codex', 'ChatGPT'],
    buildNewUri: (workspacePath, prompt) =>
      `codex://threads/new?path=${encodeURIComponent(workspacePath)}`
      + (prompt ? `&prompt=${encodeURIComponent(prompt)}` : ''),
    buildResumeUri: (sessionId) => `codex://threads/${encodeURIComponent(sessionId)}`,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    scheme: 'claude',
    icon: 'claude',
    description: 'Open Claude Code with this folder selected (Claude asks you to confirm it).',
    macAppNames: ['Claude'],
    buildNewUri: (workspacePath, prompt) =>
      `claude://code/new?folder=${encodeURIComponent(workspacePath)}`
      + (prompt ? `&q=${encodeURIComponent(prompt)}` : ''),
  },
] as const;

const EDITOR_TARGETS: readonly EditorDefinition[] = [
  { id: 'vscode-insiders', name: 'VS Code Insiders', command: 'code-insiders', icon: 'vscode-insiders', description: 'Open the generated workspace in Insiders.' },
  { id: 'vscode', name: 'VS Code', command: 'code', icon: 'vscode', description: 'Open the generated VS Code workspace.' },
  { id: 'cursor', name: 'Cursor', command: 'cursor', icon: 'cursor', description: 'Open the generated workspace in Cursor.' },
  { id: 'antigravity', name: 'Antigravity', command: 'antigravity', icon: 'antigravity', description: 'Open the workspace in Antigravity.' },
  { id: 'powershell', name: 'PowerShell', command: 'powershell', icon: 'powershell', description: 'Open an interactive PowerShell terminal in this workspace.' },
  { id: 'cmd', name: 'Command Prompt', command: 'cmd', icon: 'cmd', description: 'Open Command Prompt in this workspace.' },
  { id: 'intellij', name: 'IntelliJ IDEA', command: 'idea', icon: 'intellij', description: 'Open the workspace folder in IntelliJ IDEA.' },
  { id: 'webstorm', name: 'WebStorm', command: 'webstorm', icon: 'webstorm', description: 'Open the workspace folder in WebStorm.' },
  { id: 'pycharm', name: 'PyCharm', command: 'charm', icon: 'pycharm', description: 'Open the workspace folder in PyCharm.' },
  { id: 'sublime', name: 'Sublime Text', command: 'subl', icon: 'sublime', description: 'Open the workspace folder in Sublime Text.' },
  { id: 'zed', name: 'Zed', command: 'zed', icon: 'zed', description: 'Open the workspace folder in Zed.' },
  { id: 'windsurf', name: 'Windsurf', command: 'windsurf', icon: 'windsurf', description: 'Open the workspace folder in Windsurf.' },
] as const;

function unavailableTarget(
  definition: { id: string; name: string; icon: WorkspaceLaunchIcon; description: string },
  kind: WorkspaceLaunchTargetKind,
  unavailableReason: string,
): WorkspaceLaunchTarget {
  return { ...definition, kind, available: false, unavailableReason };
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    const result = await execa(command, args, { reject: false, shell: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Check whether the OS can activate a provider-owned desktop URI scheme. */
export async function hasDesktopProtocol(
  definition: Pick<DesktopDefinition, 'scheme' | 'macAppNames'>,
  platform = process.platform,
): Promise<boolean> {
  if (platform === 'win32') {
    const keys = [
      `HKCU\\Software\\Classes\\${definition.scheme}`,
      `HKCR\\${definition.scheme}`,
    ];
    for (const key of keys) {
      if (await commandSucceeds('reg.exe', ['query', key])) return true;
    }
    return false;
  }

  if (platform === 'darwin') {
    for (const appName of definition.macAppNames) {
      if (await commandSucceeds('/usr/bin/open', ['-Ra', appName])) return true;
    }
    return false;
  }

  if (platform === 'linux' && definition.scheme === 'claude') {
    try {
      const result = await execa(
        'xdg-mime',
        ['query', 'default', 'x-scheme-handler/claude'],
        { reject: false, shell: false },
      );
      return result.exitCode === 0 && Boolean(result.stdout?.trim());
    } catch {
      return false;
    }
  }

  return false;
}

/** Return every known target so unavailable choices can be explained in the UI. */
export async function detectWorkspaceLaunchTargets(
  platform = process.platform,
): Promise<WorkspaceLaunchTarget[]> {
  const [desktopAvailability, detectedEditors] = await Promise.all([
    Promise.all(DESKTOP_TARGETS.map((target) => hasDesktopProtocol(target, platform))),
    detectEditors(),
  ]);
  const editorAvailability = new Map(detectedEditors.map((editor) => [editor.command, editor.detected]));

  const desktops = DESKTOP_TARGETS.map((target, index): WorkspaceLaunchTarget => {
    const base = {
      id: target.id,
      name: target.name,
      icon: target.icon,
      description: target.description,
    };
    return desktopAvailability[index]
      ? { ...base, kind: 'ai-app', available: true }
      : unavailableTarget(
          base,
          'ai-app',
          platform === 'linux' && target.scheme === 'codex'
            ? 'Codex Desktop launch is currently supported on Windows and macOS.'
            : `${target.name} is not installed or its link handler is unavailable.`,
        );
  });

  const editors = EDITOR_TARGETS.map((target): WorkspaceLaunchTarget => {
    const base = {
      id: target.id,
      name: target.name,
      icon: target.icon,
      description: target.description,
    };
    return editorAvailability.get(target.command)
      ? { ...base, kind: 'editor', available: true }
      : unavailableTarget(base, 'editor', `${target.name} was not detected on PATH.`);
  });

  return [...desktops, ...editors];
}

export async function openDesktopUri(uri: string, platform = process.platform): Promise<void> {
  if (platform === 'win32') {
    const parsed = new URL(uri);
    if (!['claude:', 'codex:'].includes(parsed.protocol) || /["\r\n\0]/.test(uri)) {
      throw new Error('Unsupported desktop URI.');
    }

    // Anthropic documents `start "" "claude://..."` as the Windows launcher.
    // Pass the URI through one environment expansion so cmd.exe cannot reinterpret
    // its percent-encoded values as environment-variable references.
    try {
      await execa(
        'cmd.exe',
        ['/d', '/v:off', '/s', '/c', WINDOWS_DESKTOP_URI_COMMAND],
        {
          env: { [WINDOWS_DESKTOP_URI_ENV]: uri },
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
      );
    } catch {
      // Do not return execa's command string: it contains the local workspace
      // path and the task kickoff embedded in the deep link.
      throw new Error(
        'Windows could not open the selected desktop app. Update or reinstall the app, then try again.',
      );
    }
    return;
  }
  if (platform === 'darwin') {
    await execa('/usr/bin/open', [uri], { shell: false });
    return;
  }
  if (platform === 'linux') {
    await execa('xdg-open', [uri], { shell: false });
    return;
  }
  throw new Error('Desktop app launching is not supported on this platform.');
}

/** Launch one closed target at a validated absolute workspace directory. */
export async function launchWorkspaceTarget(
  targetId: string,
  workspacePath: string,
  intent: WorkspaceLaunchIntent = { kind: 'new-workspace' },
  platform = process.platform,
): Promise<void> {
  const absolutePath = path.resolve(workspacePath);
  if (!path.isAbsolute(workspacePath)) {
    throw new Error('Workspace path must be an absolute directory.');
  }

  const desktop = DESKTOP_TARGETS.find((target) => target.id === targetId);
  if (desktop) {
    if (!(await hasDesktopProtocol(desktop, platform))) {
      throw new Error(`${desktop.name} is not available on this computer.`);
    }
    if (intent.kind === 'resume-session') {
      if (!desktop.buildResumeUri) {
        throw new Error(`${desktop.name} does not support opening an existing coding session.`);
      }
      if (!isValidSessionUuid(intent.sessionId)) {
        throw new Error('Invalid desktop session id.');
      }
      await openDesktopUri(desktop.buildResumeUri(intent.sessionId), platform);
      return;
    }
    await openDesktopUri(desktop.buildNewUri(absolutePath, intent.prompt), platform);
    return;
  }

  const editor = EDITOR_TARGETS.find((target) => target.id === targetId);
  if (!editor) throw new Error('Unknown workspace launch target.');
  if (intent.kind === 'resume-session') {
    throw new Error('Editors cannot resume an AI coding session.');
  }

  const detected = await detectEditors();
  if (!detected.some((candidate) => candidate.command === editor.command && candidate.detected)) {
    throw new Error(`${editor.name} is not available on this computer.`);
  }
  await openInEditor(editor.command, absolutePath);
}

/** Convert a legacy editor command to its closed target id. */
export function launchTargetIdForEditorCommand(command: string): string | null {
  return EDITOR_TARGETS.find((target) => target.command === command)?.id ?? null;
}
