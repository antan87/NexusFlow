/**
 * @module orchestration/detect
 * Detects how to start each project in a workspace, and finds existing
 * orchestration tools (Docker Compose, .NET Aspire, etc.).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Feature, ServiceConfig, OrchestrationDetection } from '../types.js';
import { normalizeFeature, resolveFeatureRepoPath } from '../utils/feature.js';
import { PRIMARY_MANIFEST_FILE, LEGACY_MANIFEST_FILE } from '../core/constants.js';

/**
 * Detects existing orchestration tool configs in a directory.
 *
 * @param dir - Directory to scan (workspace root or repo root).
 * @returns Array of detected orchestration tools.
 */
export async function detectOrchestrationTools(
  dir: string,
): Promise<OrchestrationDetection[]> {
  const results: OrchestrationDetection[] = [];

  /** Stable id from the config path, POSIX-style so it survives platforms. */
  const idFor = (tool: OrchestrationDetection['tool'], configPath: string) =>
    `${tool}:${path.relative(dir, configPath).split(path.sep).join('/')}`;

  async function scan(folder: string, prefix = '') {
    // Docker Compose — one-shot: `up -d` detaches by itself, `down` stops.
    const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'];
    for (const file of composeFiles) {
      const filePath = path.join(folder, file);
      try {
        await fs.access(filePath);
        results.push({
          id: idFor('docker-compose', filePath),
          tool: 'docker-compose',
          configPath: filePath,
          startCommand: `docker compose -f "${prefix ? path.join(prefix, file) : file}" up -d`,
          stopCommand: `docker compose -f "${prefix ? path.join(prefix, file) : file}" down`,
          run: { command: 'docker', args: ['compose', '-f', filePath, 'up', '-d'], cwd: folder },
          stopRun: { command: 'docker', args: ['compose', '-f', filePath, 'down'], cwd: folder },
          mode: 'oneshot',
        });
        break; // Only use the first found
      } catch { /* not found */ }
    }

    // .NET Aspire (look for *.AppHost directories or *.AppHost.csproj)
    try {
      const entries = await fs.readdir(folder);
      for (const entry of entries) {
        if (entry.endsWith('.AppHost') || entry.includes('AppHost')) {
          const entryPath = path.join(folder, entry);
          const stat = await fs.stat(entryPath);
          if (stat.isDirectory()) {
            // Check for .csproj inside
            const subEntries = await fs.readdir(entryPath);
            const csproj = subEntries.find((e) => e.endsWith('.csproj'));
            if (csproj) {
              const csprojPath = path.join(entryPath, csproj);
              const projectPath = prefix ? path.join(prefix, entry, csproj) : path.join(entry, csproj);
              results.push({
                id: idFor('aspire', csprojPath),
                tool: 'aspire',
                configPath: csprojPath,
                startCommand: `dotnet run --project "${projectPath}"`,
                stopCommand: 'Stopped via ContextSpace',
                run: { command: 'dotnet', args: ['run', '--project', csprojPath], cwd: folder },
                mode: 'pm2',
              });
            }
          }
        }
      }
    } catch { /* ignore */ }

    // Tilt
    try {
      const tiltPath = path.join(folder, 'Tiltfile');
      await fs.access(tiltPath);
      results.push({
        id: idFor('tilt', tiltPath),
        tool: 'tilt',
        configPath: tiltPath,
        startCommand: prefix ? `tilt up --file ${path.join(prefix, 'Tiltfile')}` : 'tilt up',
        stopCommand: prefix ? `tilt down --file ${path.join(prefix, 'Tiltfile')}` : 'tilt down',
        run: { command: 'tilt', args: ['up', '--file', tiltPath], cwd: folder },
        stopRun: { command: 'tilt', args: ['down', '--file', tiltPath], cwd: folder },
        mode: 'pm2',
      });
    } catch { /* not found */ }

    // A Procfile is read as declared services (see detectDeclaredServices),
    // run directly instead of through honcho, which is rarely installed.

    // Makefile
    try {
      const makePath = path.join(folder, 'Makefile');
      const content = await fs.readFile(makePath, 'utf-8');
      // Run the target that exists, not always `dev`; `restart:` is not `start:`.
      const target = makeTarget(content, ['dev', 'start', 'run']);
      if (target) {
        const makeCmd = prefix ? `make -C "${prefix}" ${target}` : `make ${target}`;
        results.push({
          id: idFor('makefile', makePath),
          tool: 'makefile',
          configPath: makePath,
          startCommand: makeCmd,
          stopCommand: 'Stopped via ContextSpace',
          run: { command: 'make', args: ['-C', folder, target], cwd: folder },
          mode: 'pm2',
        });
      }
    } catch { /* not found */ }
  }

  // Scan root directory
  await scan(dir);

  // Scan subdirectories
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scan(path.join(dir, entry.name), entry.name);
      }
    }
  } catch { /* ignore */ }

  return results;
}

/** The first of `targets` that the Makefile defines as a rule (`name:` at line start, not `name:=`). */
function makeTarget(content: string, targets: string[]): string | undefined {
  return targets.find((target) => new RegExp(`^${target}:(?!=)`, 'm').test(content));
}

/** Declaration files, most specific first: a Procfile.dev is for local development. */
export const PROCFILE_NAMES = ['Procfile.dev', 'Procfile'] as const;

/** One `name: command` line of a Procfile. */
export interface ProcfileEntry { name: string; command: string; line: number }

/**
 * Parses Procfile lines (`name: command`). Blank lines and `#` comments are
 * skipped; a line that is not `name: command` with a name of letters, digits,
 * `_` or `-` is ignored rather than guessed at.
 */
export function parseProcfile(content: string): ProcfileEntry[] {
  const entries: ProcfileEntry[] = [];
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((raw, index) => {
    const match = /^([A-Za-z0-9_-]+):\s*(\S.*)$/.exec(raw.trim());
    if (!match || raw.trim().startsWith('#') || seen.has(match[1]!)) return;
    seen.add(match[1]!);
    entries.push({ name: match[1]!, command: match[2]!.trim(), line: index + 1 });
  });
  return entries;
}

/** A port a command names explicitly (`PORT=4000`, `--port 4000`, `-p 4000`), if any. */
export function explicitPort(command: string): number | undefined {
  const match = /(?:^|\s)PORT=(\d{2,5})\b/.exec(command) ?? /--port[=\s]+(\d{2,5})\b/i.exec(command) ?? /(?:^|\s)-p\s+(\d{2,5})\b/.exec(command);
  const port = match ? Number(match[1]) : NaN;
  return port > 0 && port < 65536 ? port : undefined;
}

/** How a Procfile line runs: through the platform shell, as foreman and honcho do. */
export function shellInvocation(command: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  return platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { command: '/bin/sh', args: ['-c', command] };
}

/**
 * Services a project declares: every line of its `Procfile.dev`, or of its
 * `Procfile` when there is no `Procfile.dev`. Names are `project/process`.
 */
export async function detectDeclaredServices(projectPath: string, projectName: string): Promise<ServiceConfig[]> {
  for (const file of PROCFILE_NAMES) {
    let content: string;
    try {
      content = await fs.readFile(path.join(projectPath, file), 'utf-8');
    } catch {
      continue;
    }
    return parseProcfile(content).map((entry) => ({
      name: `${projectName}/${entry.name}`,
      cwd: projectPath,
      ...shellInvocation(entry.command),
      port: explicitPort(entry.command),
      source: 'procfile' as const,
      declared: true,
      declaredIn: { file, line: entry.line },
      display: entry.command,
    }));
  }
  return [];
}

/** A suggested `Procfile.dev` for one repository, built from its guessed services. */
export interface ProcfileSuggestion { file: string; content: string }

/**
 * Turns guessed services into `Procfile.dev` suggestions, one file per
 * repository root, so declaring them is a review-and-save step. A service
 * found in a subfolder runs from there with `cd`. The commands are the
 * guesses as they are: the reader keeps only real long-running processes.
 */
export function suggestProcfiles(guessed: ServiceConfig[]): ProcfileSuggestion[] {
  const byRoot = new Map<string, string[]>();
  for (const service of guessed) {
    const [, sub] = service.name.split('/');
    const root = sub ? path.dirname(service.cwd) : service.cwd;
    const processName = (sub ?? 'web').replace(/[^A-Za-z0-9_-]/g, '-') || 'web';
    const command = [service.command, ...service.args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
    const lines = byRoot.get(root) ?? [];
    lines.push(`${processName}: ${sub ? `cd ${sub} && ` : ''}${command}`);
    byRoot.set(root, lines);
  }
  return [...byRoot].map(([root, lines]) => ({ file: path.join(root, 'Procfile.dev'), content: `${lines.join('\n')}\n` }));
}

/**
 * Detects how to start a single project based on its manifest files.
 *
 * @param projectPath - Absolute path to the project directory.
 * @param projectName - Display name of the project.
 * @returns A ServiceConfig if a start command was detected, null otherwise.
 */
export async function detectServiceConfig(
  projectPath: string,
  projectName: string,
): Promise<ServiceConfig | null> {
  // ── Node.js (package.json) ────────────────────────────────────────
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;

    if (scripts) {
      // Priority: dev > start > serve
      const scriptName = scripts['dev'] ? 'dev' : scripts['start'] ? 'start' : scripts['serve'] ? 'serve' : null;
      if (scriptName) {
        // Detect port from script content
        const scriptContent = scripts[scriptName]!;
        const portMatch = scriptContent.match(/--port\s+(\d+)/i) ?? scriptContent.match(/-p\s+(\d+)/);
        const port = portMatch ? parseInt(portMatch[1]!, 10) : undefined;

        return {
          name: projectName,
          cwd: projectPath,
          command: 'npm',
          args: ['run', scriptName],
          port,
          source: 'package.json',
        };
      }
    }
  } catch { /* no package.json */ }

  // ── .NET (*.csproj) ───────────────────────────────────────────────
  try {
    const entries = await fs.readdir(projectPath);
    const csproj = entries.find((e) => e.endsWith('.csproj'));
    if (csproj) {
      // Check launchSettings for port
      let port: number | undefined;
      try {
        const raw = await fs.readFile(
          path.join(projectPath, 'Properties', 'launchSettings.json'),
          'utf-8',
        );
        const settings = JSON.parse(raw) as Record<string, unknown>;
        const profiles = settings.profiles as Record<string, Record<string, unknown>> | undefined;
        if (profiles) {
          const firstProfile = Object.values(profiles)[0];
          const appUrl = firstProfile?.applicationUrl as string | undefined;
          if (appUrl) {
            const portMatch = appUrl.match(/:(\d+)/);
            if (portMatch) port = parseInt(portMatch[1]!, 10);
          }
        }
      } catch { /* no launchSettings */ }

      return {
        name: projectName,
        cwd: projectPath,
        command: 'dotnet',
        args: ['run'],
        port,
        source: 'dotnet',
      };
    }
  } catch { /* ignore */ }

  // ── Python ────────────────────────────────────────────────────────
  try {
    await fs.access(path.join(projectPath, 'manage.py'));
    return {
      name: projectName,
      cwd: projectPath,
      command: 'python',
      args: ['manage.py', 'runserver'],
      port: 8000,
      source: 'python',
    };
  } catch { /* not Django */ }

  try {
    // Check for main.py or app.py (FastAPI/Flask)
    const hasAppPy = await fs.access(path.join(projectPath, 'app.py')).then(() => true).catch(() => false);
    const hasMainPy = await fs.access(path.join(projectPath, 'main.py')).then(() => true).catch(() => false);

    if (hasMainPy || hasAppPy) {
      const entryFile = hasMainPy ? 'main.py' : 'app.py';
      const content = await fs.readFile(path.join(projectPath, entryFile), 'utf-8');

      if (content.includes('FastAPI') || content.includes('fastapi')) {
        return {
          name: projectName,
          cwd: projectPath,
          command: 'uvicorn',
          args: [`${entryFile.replace('.py', '')}:app`, '--reload'],
          port: 8000,
          source: 'python',
        };
      }

      if (content.includes('Flask') || content.includes('flask')) {
        return {
          name: projectName,
          cwd: projectPath,
          command: 'python',
          args: [entryFile],
          port: 5000,
          source: 'python',
        };
      }
    }
  } catch { /* ignore */ }

  // ── Go ────────────────────────────────────────────────────────────
  try {
    await fs.access(path.join(projectPath, 'go.mod'));
    return {
      name: projectName,
      cwd: projectPath,
      command: 'go',
      args: ['run', '.'],
      source: 'go',
    };
  } catch { /* no go.mod */ }

  // ── Makefile ──────────────────────────────────────────────────────
  try {
    const content = await fs.readFile(path.join(projectPath, 'Makefile'), 'utf-8');
    const target = makeTarget(content, ['dev', 'run']);
    if (target) {
      return { name: projectName, cwd: projectPath, command: 'make', args: [target], source: 'makefile' };
    }
  } catch { /* no Makefile */ }

  return null;
}

/**
 * Detects service configs for all projects in a workspace.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @returns Array of detected ServiceConfig objects.
 */
export async function detectAllServices(
  workspacePath: string,
): Promise<ServiceConfig[]> {
  const services: ServiceConfig[] = [];

  // Prefer the manifest: it knows where the repos actually live (worktree
  // subdirectories, or the source repositories for in-place features, which
  // have no subdirectories to scan). Parsed directly — not via
  // core/workspace.js — to keep this module free of import cycles.
  let feature: Feature | null = null;
  try {
    const raw = await fs.readFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), 'utf-8');
    feature = normalizeFeature(JSON.parse(raw) as Feature);
  } catch {
    try {
      const raw = await fs.readFile(path.join(workspacePath, LEGACY_MANIFEST_FILE), 'utf-8');
      feature = normalizeFeature(JSON.parse(raw) as Feature);
    } catch {
      // No/invalid manifest — fall back to scanning subdirectories below.
    }
  }

  if (feature) {
    for (const repoPath of feature.repos) {
      const name = path.basename(repoPath);
      const projectPath = resolveFeatureRepoPath(feature, workspacePath, repoPath);
      await detectProjectServices(projectPath, name, services);
    }
    return services;
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(workspacePath, { withFileTypes: true });
  } catch {
    return services;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden dirs and known non-project dirs
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    await detectProjectServices(path.join(workspacePath, entry.name), entry.name, services);
  }

  return services;
}

/**
 * Detects a project's service config at its root, falling back to first-level
 * subdirectories (e.g. nested packages), appending results to `services`.
 */
async function detectProjectServices(
  projectPath: string,
  projectName: string,
  services: ServiceConfig[],
): Promise<void> {
  // What the repository declares replaces anything we would guess for it.
  const declared = await detectDeclaredServices(projectPath, projectName);
  if (declared.length > 0) {
    services.push(...declared);
    return;
  }

  const config = await detectServiceConfig(projectPath, projectName);
  if (config) {
    services.push({ ...config, declared: false });
    return;
  }

  try {
    const subEntries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue;
      if (subEntry.name.startsWith('.') || subEntry.name === 'node_modules') continue;

      const subProjectPath = path.join(projectPath, subEntry.name);
      const subConfig = await detectServiceConfig(subProjectPath, `${projectName}/${subEntry.name}`);
      if (subConfig) {
        services.push({ ...subConfig, declared: false });
      }
    }
  } catch { /* ignore read errors */ }
}
