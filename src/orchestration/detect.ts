/**
 * @module orchestration/detect
 * Detects how to start each project in a workspace, and finds existing
 * orchestration tools (Docker Compose, .NET Aspire, etc.).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Feature, ServiceConfig, OrchestrationDetection } from '../types.js';
import { normalizeFeature, resolveFeatureRepoPath } from '../utils/feature.js';

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
                stopCommand: 'Stopped via NexusFlow',
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

    // Procfile
    try {
      const procPath = path.join(folder, 'Procfile');
      await fs.access(procPath);
      results.push({
        id: idFor('procfile', procPath),
        tool: 'procfile',
        configPath: procPath,
        startCommand: prefix ? `honcho start -f ${path.join(prefix, 'Procfile')}` : 'honcho start',
        stopCommand: 'Stopped via NexusFlow',
        run: { command: 'honcho', args: ['start', '-f', procPath], cwd: folder },
        mode: 'pm2',
      });
    } catch { /* not found */ }

    // Makefile
    try {
      const makePath = path.join(folder, 'Makefile');
      const content = await fs.readFile(makePath, 'utf-8');
      if (content.includes('start:') || content.includes('dev:') || content.includes('run:')) {
        const makeCmd = prefix ? `make -C "${prefix}" dev` : 'make dev';
        results.push({
          id: idFor('makefile', makePath),
          tool: 'makefile',
          configPath: makePath,
          startCommand: makeCmd,
          stopCommand: 'Stopped via NexusFlow',
          run: { command: 'make', args: ['-C', folder, 'dev'], cwd: folder },
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
    if (content.includes('dev:')) {
      return { name: projectName, cwd: projectPath, command: 'make', args: ['dev'], source: 'makefile' };
    }
    if (content.includes('run:')) {
      return { name: projectName, cwd: projectPath, command: 'make', args: ['run'], source: 'makefile' };
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
    const raw = await fs.readFile(path.join(workspacePath, 'nexusflow.json'), 'utf-8');
    feature = normalizeFeature(JSON.parse(raw) as Feature);
  } catch {
    // No/invalid manifest — fall back to scanning subdirectories below.
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
  const config = await detectServiceConfig(projectPath, projectName);
  if (config) {
    services.push(config);
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
        services.push(subConfig);
      }
    }
  } catch { /* ignore read errors */ }
}
