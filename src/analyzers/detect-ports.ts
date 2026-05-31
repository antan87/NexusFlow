/**
 * @module analyzers/detect-ports
 * Detects configured ports and services in a repository by inspecting
 * environment files, Docker configs, and framework-specific settings.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ServicePort } from '../types.js';

/**
 * Detects ports and service endpoints configured in a repository.
 *
 * Scans:
 * - .env / .env.* files for PORT= patterns
 * - docker-compose.yml for port mappings
 * - launchSettings.json (.NET) for applicationUrl
 * - package.json scripts for --port flags
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of detected {@link ServicePort} objects.
 */
export async function detectPorts(repoPath: string): Promise<ServicePort[]> {
  const ports: ServicePort[] = [];
  const seen = new Set<number>();

  const addPort = (port: number, protocol: 'http' | 'https' | 'grpc' | 'other', source: string) => {
    if (!seen.has(port)) {
      seen.add(port);
      ports.push({ port, protocol, source });
    }
  };

  // ── .env files ────────────────────────────────────────────────────
  const envFiles = ['.env', '.env.local', '.env.development'];
  for (const envFile of envFiles) {
    try {
      const content = await fs.readFile(path.join(repoPath, envFile), 'utf-8');
      const portMatch = content.match(/PORT\s*=\s*(\d+)/i);
      if (portMatch) {
        addPort(parseInt(portMatch[1]!, 10), 'http', envFile);
      }
    } catch {
      // File doesn't exist
    }
  }

  // ── docker-compose.yml ────────────────────────────────────────────
  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'];
  for (const composeFile of composeFiles) {
    try {
      const content = await fs.readFile(path.join(repoPath, composeFile), 'utf-8');
      // Simple regex to extract port mappings like "3000:3000" or "- 8080:80"
      const portRegex = /["']?(\d+):(\d+)["']?/g;
      let match: RegExpExecArray | null;
      while ((match = portRegex.exec(content)) !== null) {
        addPort(parseInt(match[1]!, 10), 'http', composeFile);
      }
    } catch {
      // File doesn't exist
    }
  }

  // ── launchSettings.json (.NET) ────────────────────────────────────
  const launchSettingsPath = path.join(repoPath, 'Properties', 'launchSettings.json');
  try {
    const raw = await fs.readFile(launchSettingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const profiles = settings.profiles as Record<string, Record<string, unknown>> | undefined;

    if (profiles) {
      for (const profile of Object.values(profiles)) {
        const appUrl = profile.applicationUrl as string | undefined;
        if (appUrl) {
          const urlParts = appUrl.split(';');
          for (const url of urlParts) {
            const portMatch = url.match(/:(\d+)/);
            if (portMatch) {
              const protocol = url.startsWith('https') ? 'https' : 'http';
              addPort(parseInt(portMatch[1]!, 10), protocol, 'launchSettings.json');
            }
          }
        }
      }
    }
  } catch {
    // No launchSettings.json
  }

  // ── package.json scripts ──────────────────────────────────────────
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string> | undefined;

    if (scripts) {
      for (const script of Object.values(scripts)) {
        const portMatch = script.match(/--port\s+(\d+)/i) ?? script.match(/-p\s+(\d+)/);
        if (portMatch) {
          addPort(parseInt(portMatch[1]!, 10), 'http', 'package.json scripts');
        }
      }
    }
  } catch {
    // No package.json
  }

  return ports;
}
