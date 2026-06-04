/**
 * @module analyzers/run-analyzer
 * Analyzes projects to discover local run configurations, entry points,
 * database dependencies, external services, and flags shared staging/test
 * infrastructure or committed secrets.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import type { RunConfig, RunConfigEntryPoint, RunConfigDatabase, RunConfigSharedInfraWarning, RunConfigSecret } from '../types.js';

/**
 * Analyzes local run configurations, databases, and dependencies in a repository.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Run configuration analysis.
 */
export async function analyzeRunConfig(repoPath: string): Promise<RunConfig> {
  const entryPoints: RunConfigEntryPoint[] = [];
  const databases: RunConfigDatabase[] = [];
  const sharedInfraWarnings: RunConfigSharedInfraWarning[] = [];
  const committedSecrets: RunConfigSecret[] = [];
  const externalDependencies: string[] = [];

  const isLocalHost = (host: string): boolean => {
    const h = host.toLowerCase().trim();
    return (
      h.includes('localhost') ||
      h.includes('127.0.0.1') ||
      h.includes('[::1]') ||
      h.includes('(localdb)') ||
      h === 'db' ||
      h === 'postgres' ||
      h === 'redis' ||
      h === 'mongo'
    );
  };

  try {
    // ── 1. Entry Points Detection ──────────────────────────────────────────
    // A. Check for C# Web/Worker apps
    const csprojFiles = await globby('**/*.csproj', {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    for (const file of csprojFiles) {
      try {
        const content = await fsp.readFile(file, 'utf-8');
        const relPath = path.relative(repoPath, file).replace(/\\/g, '/');
        if (content.includes('Sdk="Microsoft.NET.Sdk.Web"')) {
          entryPoints.push({
            projectPath: relPath,
            type: 'aspnet',
            command: 'dotnet run',
          });
        } else if (content.includes('Sdk="Microsoft.NET.Sdk.Worker"')) {
          entryPoints.push({
            projectPath: relPath,
            type: 'worker',
            command: 'dotnet run',
          });
        }
      } catch {}
    }

    // B. Check for package.json (Node/JS/TS)
    const packageJsonPath = path.join(repoPath, 'package.json');
    try {
      const raw = await fsp.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(raw);
      if (pkg.scripts && (pkg.scripts.start || pkg.scripts.dev)) {
        entryPoints.push({
          projectPath: 'package.json',
          type: pkg.dependencies && pkg.dependencies.next ? 'nextjs' : 'node',
          command: pkg.scripts.dev ? 'npm run dev' : 'npm start',
        });
      }
    } catch {}

    // C. Check for Python/Go
    const goModFiles = await globby('**/go.mod', { cwd: repoPath, absolute: true });
    if (goModFiles.length > 0) {
      entryPoints.push({
        projectPath: path.relative(repoPath, goModFiles[0]!).replace(/\\/g, '/'),
        type: 'go',
        command: 'go run .',
      });
    }

    const pyFiles = await globby(['**/requirements.txt', '**/Pipfile', '**/pyproject.toml'], { cwd: repoPath, absolute: true });
    if (pyFiles.length > 0) {
      entryPoints.push({
        projectPath: path.relative(repoPath, pyFiles[0]!).replace(/\\/g, '/'),
        type: 'python',
        command: 'python main.py',
      });
    }

    // ── 2. Config Files Parsing (DBs, Shared Infra, Secrets) ───────────────
    const configFiles = await globby(
      ['**/appsettings.json', '**/appsettings.Development.json', '**/appsettings.*.json', '**/.env', '**/.env.development', '**/.env.local'],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      }
    );

    for (const file of configFiles) {
      try {
        const content = await fsp.readFile(file, 'utf-8');
        const relPath = path.relative(repoPath, file).replace(/\\/g, '/');

        // Secrets Check (Universal regex for high probability secrets)
        const secretRegex = /(?:password|pwd|secret|key|token|privatekey|accountkey|sharedaccesskey)\s*[=:]\s*['"`]?([^'";\s]{12,})['"`]?/gi;
        let secretMatch: RegExpExecArray | null;
        while ((secretMatch = secretRegex.exec(content)) !== null) {
          const matchedVal = secretMatch[1]!;
          // Skip if it looks like a placeholder
          if (!matchedVal.includes('placeholder') && !matchedVal.includes('<your') && !matchedVal.toLowerCase().includes('your_')) {
            committedSecrets.push({
              file: relPath,
              lineHint: secretMatch[0]!.split(/[=:]/)[0]!.trim(),
            });
          }
        }

        if (file.endsWith('.json')) {
          const parsed = JSON.parse(content);
          
          // connectionStrings
          if (parsed.ConnectionStrings) {
            for (const [key, value] of Object.entries(parsed.ConnectionStrings)) {
              if (typeof value === 'string') {
                let provider = 'unknown';
                if (value.toLowerCase().includes('sql server') || value.toLowerCase().includes('sqlexpress') || value.toLowerCase().includes('server=')) {
                  provider = 'SQL Server';
                }
                if (value.toLowerCase().includes('postgresql') || value.toLowerCase().includes('port=5432')) {
                  provider = 'PostgreSQL';
                }

                // Extract Host
                const hostMatch = value.match(/Server=([^;]+)/i) ?? value.match(/Host=([^;]+)/i) ?? value.match(/Data Source=([^;]+)/i);
                const host = hostMatch ? hostMatch[1]!.trim() : 'unknown';

                databases.push({
                  provider,
                  host,
                  configFile: relPath,
                });

                if (host !== 'unknown' && !isLocalHost(host)) {
                  sharedInfraWarnings.push({
                    resource: key,
                    host,
                    configFile: relPath,
                    warning: `⚠️ SHARED INFRA: ${relPath} binds ConnectionString "${key}" to non-local host (${host}). Running locally may connect to shared test/production databases.`,
                  });
                }
              }
            }
          }

          // Service Bus or MQ settings
          const rabbitRegex = /"HostName"\s*:\s*"([^"]+)"/gi;
          let rabbitMatch: RegExpExecArray | null;
          while ((rabbitMatch = rabbitRegex.exec(content)) !== null) {
            const host = rabbitMatch[1]!;
            if (!isLocalHost(host)) {
              sharedInfraWarnings.push({
                resource: 'RabbitMQ',
                host,
                configFile: relPath,
                warning: `⚠️ SHARED INFRA: ${relPath} binds RabbitMQ host to non-local host (${host}).`,
              });
            }
          }
        } else {
          // B. .env parsing
          const lines = content.split('\n');
          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('#') || !cleanLine.includes('=')) continue;

            const [key, val] = cleanLine.split('=', 2);
            if (!key || !val) continue;

            const cleanKey = key.trim();
            const cleanVal = val.trim().replace(/^['"]|['"]$/g, '');

            // DB UrL e.g. DATABASE_URL=postgres://user:pass@host:port/db
            if (cleanKey.includes('DATABASE_URL') || cleanKey.includes('MONGODB_URI') || cleanKey.includes('REDIS_URL')) {
              let provider = 'unknown';
              if (cleanVal.startsWith('postgres')) provider = 'PostgreSQL';
              else if (cleanVal.startsWith('mongodb')) provider = 'MongoDB';
              else if (cleanVal.startsWith('redis')) provider = 'Redis';

              // Extract Host from URL
              const hostMatch = cleanVal.match(/@([^:/]+)/);
              const host = hostMatch ? hostMatch[1]! : cleanVal;

              databases.push({
                provider,
                host,
                configFile: relPath,
              });

              if (!isLocalHost(host)) {
                sharedInfraWarnings.push({
                  resource: cleanKey,
                  host,
                  configFile: relPath,
                  warning: `⚠️ SHARED INFRA: .env variable "${cleanKey}" points to non-local host (${host}).`,
                });
              }
            }
          }
        }
      } catch {}
    }

  } catch {
    // Ignore errors
  }

  // De-duplicate external dependencies / warnings
  const uniqueInfraWarnings: RunConfigSharedInfraWarning[] = [];
  const seenInfra = new Set<string>();
  for (const w of sharedInfraWarnings) {
    const key = `${w.resource}:${w.host}:${w.configFile}`;
    if (!seenInfra.has(key)) {
      seenInfra.add(key);
      uniqueInfraWarnings.push(w);
    }
  }

  const uniqueDatabases: RunConfigDatabase[] = [];
  const seenDb = new Set<string>();
  for (const db of databases) {
    const key = `${db.provider}:${db.host}:${db.configFile}`;
    if (!seenDb.has(key)) {
      seenDb.add(key);
      uniqueDatabases.push(db);
    }
  }

  const uniqueSecrets: RunConfigSecret[] = [];
  const seenSecret = new Set<string>();
  for (const s of committedSecrets) {
    const key = `${s.file}:${s.lineHint}`;
    if (!seenSecret.has(key)) {
      seenSecret.add(key);
      uniqueSecrets.push(s);
    }
  }

  return {
    entryPoints,
    databases: uniqueDatabases,
    sharedInfraWarnings: uniqueInfraWarnings,
    committedSecrets: uniqueSecrets,
    externalDependencies,
  };
}
