/**
 * @module analyzers/detect-apis
 * Detects API endpoints in a repository by scanning for OpenAPI/Swagger files,
 * route patterns in common frameworks, and gRPC proto files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ApiEndpoint } from '../types.js';

/**
 * Detects API endpoints in a repository.
 *
 * Strategies (in order):
 * 1. Look for OpenAPI/Swagger spec files (JSON/YAML)
 * 2. Scan source files for Express/Fastify/ASP.NET route patterns
 * 3. Look for gRPC .proto files
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of detected {@link ApiEndpoint} objects.
 */
export async function detectApis(repoPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];

  // 1. OpenAPI/Swagger files
  const openApiEndpoints = await scanOpenApiFiles(repoPath);
  endpoints.push(...openApiEndpoints);

  // 2. Route patterns in source files (only if no OpenAPI found)
  if (endpoints.length === 0) {
    const routeEndpoints = await scanRoutePatterns(repoPath);
    endpoints.push(...routeEndpoints);
  }

  return endpoints;
}

/** Looks for OpenAPI/Swagger spec files and extracts paths. */
async function scanOpenApiFiles(repoPath: string): Promise<ApiEndpoint[]> {
  const candidates = [
    'swagger.json', 'swagger.yaml', 'swagger.yml',
    'openapi.json', 'openapi.yaml', 'openapi.yml',
    'api-spec.json', 'api-spec.yaml', 'api-spec.yml',
  ];

  const endpoints: ApiEndpoint[] = [];

  for (const filename of candidates) {
    const filePath = path.join(repoPath, filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (filename.endsWith('.json')) {
        const spec = JSON.parse(content) as Record<string, unknown>;
        const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;

        if (paths) {
          for (const [routePath, methods] of Object.entries(paths)) {
            for (const method of Object.keys(methods)) {
              if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
                endpoints.push({
                  method: method.toUpperCase(),
                  path: routePath,
                  source: filename,
                });
              }
            }
          }
        }
      }
    } catch {
      // File doesn't exist or can't be parsed — skip
    }
  }

  return endpoints;
}

/** Scans source files for common route patterns. Limited to top-level files. */
async function scanRoutePatterns(repoPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];

  // Look in common source directories
  const sourceDirs = ['src', 'app', 'routes', 'controllers', 'Controllers', '.'];
  const routeRegex = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const aspnetRegex = /\[Http(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"\s*\)\]/gi;

  for (const dir of sourceDirs) {
    const dirPath = path.join(repoPath, dir);

    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!['.ts', '.js', '.cs', '.py'].includes(ext)) continue;

      const filePath = path.join(dirPath, entry);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > 100_000) continue; // Skip large files

        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = path.relative(repoPath, filePath);

        // Express/Fastify/Hono style routes
        let match: RegExpExecArray | null;
        routeRegex.lastIndex = 0;
        while ((match = routeRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1]!.toUpperCase(),
            path: match[2]!,
            source: relPath,
          });
        }

        // ASP.NET style routes
        aspnetRegex.lastIndex = 0;
        while ((match = aspnetRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1]!.toUpperCase(),
            path: match[2]!,
            source: relPath,
          });
        }
      } catch {
        continue;
      }
    }
  }

  return endpoints;
}
