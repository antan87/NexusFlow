/**
 * @module analyzers/detect-apis
 * Detects API endpoints in a repository by scanning for OpenAPI/Swagger files,
 * route patterns in common frameworks, and gRPC proto files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

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

/** Scans C# files for controllers and Minimal APIs. */
function extractCsEndpoints(content: string, relPath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  // 1. Controller style routing
  const classRegex = /class\s+(\w+Controller)/gi;
  const classes: { name: string; index: number }[] = [];
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(content)) !== null) {
    classes.push({
      name: classMatch[1],
      index: classMatch.index,
    });
  }

  const routeAttrRegex = /\[Route\s*\(\s*"([^"]*)"\s*\)\]/gi;
  const classRoutes: { route: string; index: number }[] = [];
  let routeMatch: RegExpExecArray | null;
  while ((routeMatch = routeAttrRegex.exec(content)) !== null) {
    classRoutes.push({
      route: routeMatch[1],
      index: routeMatch.index,
    });
  }

  const versionAttrRegex = /\[ApiVersion\s*\(\s*["']?([^"'\s\)]+)["']?\s*\)\]/gi;
  const apiVersions: { version: string; index: number }[] = [];
  let versionMatch: RegExpExecArray | null;
  while ((versionMatch = versionAttrRegex.exec(content)) !== null) {
    apiVersions.push({
      version: versionMatch[1],
      index: versionMatch.index,
    });
  }

  const controllerRoutes: {
    route: string;
    controllerName: string;
    version?: string;
    classIndex: number;
  }[] = [];

  for (const cr of classRoutes) {
    const targetClass = classes.find(c => c.index > cr.index);
    if (targetClass) {
      const targetVersion = apiVersions.find(v => v.index > cr.index - 100 && v.index < targetClass.index);
      controllerRoutes.push({
        route: cr.route,
        controllerName: targetClass.name,
        version: targetVersion?.version,
        classIndex: targetClass.index,
      });
    }
  }

  const httpAttrRegex = /\[Http(Get|Post|Put|Patch|Delete)(?:\s*\(\s*"([^"]*)"\s*\))?\]/gi;
  let httpMatch: RegExpExecArray | null;
  while ((httpMatch = httpAttrRegex.exec(content)) !== null) {
    const method = httpMatch[1].toUpperCase();
    const actionRoute = httpMatch[2] || '';
    const index = httpMatch.index;

    let matchedController = controllerRoutes[0];
    for (const cr of controllerRoutes) {
      if (cr.classIndex < index) {
        matchedController = cr;
      } else {
        break;
      }
    }

    let resolvedRoute = '';
    if (matchedController) {
      let baseRoute = matchedController.route;
      const controllerBaseName = matchedController.controllerName.replace(/Controller$/i, '');
      baseRoute = baseRoute.replace(/\[controller\]/gi, controllerBaseName);
      
      const ver = matchedController.version;
      const verReplacement = ver ? 'v' + ver.split('.')[0] : 'v1';
      baseRoute = baseRoute.replace(/\{version(:apiVersion)?\}/gi, verReplacement);

      if (actionRoute) {
        resolvedRoute = baseRoute.endsWith('/') || actionRoute.startsWith('/')
          ? `${baseRoute}${actionRoute}`
          : `${baseRoute}/${actionRoute}`;
      } else {
        resolvedRoute = baseRoute;
      }
    } else {
      resolvedRoute = actionRoute;
    }

    resolvedRoute = resolvedRoute
      .replace(/\/+/g, '/')
      .replace(/:[a-zA-Z0-9\?]+/g, '');
    
    if (resolvedRoute && !resolvedRoute.startsWith('/')) {
      resolvedRoute = '/' + resolvedRoute;
    }

    if (resolvedRoute) {
      endpoints.push({
        method,
        path: resolvedRoute,
        source: relPath,
      });
    }
  }

  // 2. Minimal API style routing
  const groupRegex = /(?:const|var|let)?\s*(\w+)\s*=\s*(?:\w+)\.MapGroup\s*\(\s*"([^"]+)"/gi;
  const groups = new Map<string, string>();
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRegex.exec(content)) !== null) {
    groups.set(groupMatch[1], groupMatch[2]);
  }

  const minimalApiRegex = /\b(\w+)?\.?Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/gi;
  let minMatch: RegExpExecArray | null;
  while ((minMatch = minimalApiRegex.exec(content)) !== null) {
    const varName = minMatch[1];
    const method = minMatch[2].toUpperCase();
    const actionRoute = minMatch[3];

    let fullPath = actionRoute;
    if (varName && groups.has(varName)) {
      const groupPath = groups.get(varName)!;
      fullPath = groupPath.endsWith('/') || actionRoute.startsWith('/')
        ? `${groupPath}${actionRoute}`
        : `${groupPath}/${actionRoute}`;
    }

    fullPath = fullPath
      .replace(/\/+/g, '/')
      .replace(/:[a-zA-Z0-9\?]+/g, '');

    if (fullPath && !fullPath.startsWith('/')) {
      fullPath = '/' + fullPath;
    }

    if (fullPath) {
      endpoints.push({
        method,
        path: fullPath,
        source: relPath,
      });
    }
  }

  return endpoints;
}

/** Scans source files for common route patterns recursively using globby. */
async function scanRoutePatterns(repoPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const routeRegex = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  try {
    const files = await globby(
      ['**/*.ts', '**/*.js', '**/*.cs', '**/*.py'],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      }
    );

    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 100_000) continue; // Skip large files

        const content = await fs.readFile(file, 'utf-8');
        const relPath = path.relative(repoPath, file);

        if (file.endsWith('.cs')) {
          endpoints.push(...extractCsEndpoints(content, relPath));
        } else {
          // Express/Fastify/Hono/etc style routes
          let match: RegExpExecArray | null;
          routeRegex.lastIndex = 0;
          while ((match = routeRegex.exec(content)) !== null) {
            endpoints.push({
              method: match[1]!.toUpperCase(),
              path: match[2]!,
              source: relPath,
            });
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore errors
  }

  // De-duplicate endpoints
  const seen = new Set<string>();
  const uniqueEndpoints: ApiEndpoint[] = [];
  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEndpoints.push(ep);
    }
  }

  return uniqueEndpoints;
}
