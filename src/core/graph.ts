import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
import type { WorkspaceContext, RepoInfo } from '../types.js';

export interface GraphNode {
  id: string;
  type: 'repo' | 'package' | 'endpoint' | 'port';
  name: string;
  metadata: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'CONTAINS' | 'DEPENDS_ON' | 'EXPOSES' | 'CALLS';
  metadata?: Record<string, any>;
}

export interface WorkspaceGraph {
  workspaceId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Builds a structural and API interaction graph across all repos in a workspace.
 */
export async function buildWorkspaceGraph(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<WorkspaceGraph> {
  const { feature, repos, analysis } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // 1. Add Repository Nodes
  for (const repo of repos) {
    const a = analysis?.get(repo.path);
    nodes.push({
      id: `repo:${repo.name}`,
      type: 'repo',
      name: repo.name,
      metadata: {
        path: repo.path,
        techStack: a?.techStack || null,
        description: a?.readmeSummary || '',
      },
    });
  }

  // 2. Add API Endpoint and Port Nodes, and EXPOSES Edges
  const allEndpoints: { endpointId: string; method: string; path: string; repoName: string }[] = [];
  
  if (analysis) {
    for (const repo of repos) {
      const a = analysis.get(repo.path);
      if (!a) continue;

      // Add Ports
      for (const p of a.ports) {
        const portId = `port:${repo.name}:${p.port}`;
        nodes.push({
          id: portId,
          type: 'port',
          name: `${p.port}`,
          metadata: {
            protocol: p.protocol,
            source: p.source,
          },
        });
        edges.push({
          source: `repo:${repo.name}`,
          target: portId,
          type: 'EXPOSES',
        });
      }

      // Add API Endpoints
      for (const ep of a.endpoints) {
        const endpointId = `endpoint:${repo.name}:${ep.method}:${ep.path}`;
        nodes.push({
          id: endpointId,
          type: 'endpoint',
          name: `${ep.method} ${ep.path}`,
          metadata: {
            method: ep.method,
            path: ep.path,
            source: ep.source,
          },
        });
        edges.push({
          source: `repo:${repo.name}`,
          target: endpointId,
          type: 'EXPOSES',
        });

        allEndpoints.push({
          endpointId,
          method: ep.method,
          path: ep.path,
          repoName: repo.name,
        });
      }

      // Add package dependencies
      for (const dep of a.dependencies) {
        const packageId = `package:${dep.type}:${dep.name}`;
        if (!nodes.some((n) => n.id === packageId)) {
          nodes.push({
            id: packageId,
            type: 'package',
            name: dep.name,
            metadata: {
              manager: dep.type,
              version: dep.version || 'latest',
            },
          });
        }
        edges.push({
          source: `repo:${repo.name}`,
          target: packageId,
          type: 'DEPENDS_ON',
        });
      }
    }
  }

  // 3. Add inter-repo DEPENDS_ON edges
  if (analysis) {
    const repoNames = new Map(repos.map((r) => [r.path, r.name]));
    const { findInterRepoDependencies } = await import('../analyzers/detect-deps.js');
    const interDeps = findInterRepoDependencies(analysis, repoNames);

    for (const [caller, callees] of interDeps) {
      for (const callee of callees) {
        edges.push({
          source: `repo:${caller}`,
          target: `repo:${callee}`,
          type: 'DEPENDS_ON',
          metadata: { relation: 'repo-to-repo' },
        });
      }
    }
  }

  // 4. Detect CALLS Edges using git grep inside worktrees
  for (const ep of allEndpoints) {
    const pathQuery = ep.path;
    // Skip very short or generic paths to avoid false positives and noise
    if (!pathQuery || pathQuery.length < 4 || pathQuery === '/api' || pathQuery === '/dev') continue;

    for (const repo of repos) {
      if (repo.name === ep.repoName) continue; // Skip self

      const worktreePath = path.join(workspacePath, repo.name);
      try {
        await fs.access(worktreePath);
        // Use git grep to find references to this endpoint path in other worktrees
        const { stdout } = await execa('git', ['grep', '-l', '-F', pathQuery], {
          cwd: worktreePath,
          reject: false,
        });

        if (stdout && stdout.trim()) {
          const files = stdout.split('\n').filter(Boolean);
          edges.push({
            source: `repo:${repo.name}`,
            target: ep.endpointId,
            type: 'CALLS',
            metadata: {
              files,
              reason: `References endpoint path '${pathQuery}'`,
            },
          });
        }
      } catch {
        // Ignore git grep failures
      }
    }
  }

  return {
    workspaceId: feature.id,
    nodes,
    edges,
  };
}

/**
 * Builds a Mermaid Flowchart representation of the workspace architecture graph.
 */
export function buildMermaidDiagram(graph: WorkspaceGraph): string {
  const lines: string[] = ['flowchart TD'];

  lines.push('  classDef repo fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;');
  lines.push('  classDef endpoint fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;');
  lines.push('  classDef port fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff;');
  lines.push('  classDef package fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;');

  // Render Repo nodes
  for (const n of graph.nodes) {
    if (n.type === 'repo') {
      lines.push(`  ${n.id}["📦 ${n.name}"]:::repo`);
    }
  }

  // Render edges between repos
  const repoEdges = graph.edges.filter(
    (e) => e.source.startsWith('repo:') && e.target.startsWith('repo:'),
  );
  for (const e of repoEdges) {
    lines.push(`  ${e.source} -->|depends on| ${e.target}`);
  }

  // Render API calls and endpoint interactions
  const callsEdges = graph.edges.filter((e) => e.type === 'CALLS');
  const referencedEndpointIds = new Set(callsEdges.map((e) => e.target));

  for (const n of graph.nodes) {
    if (n.type === 'endpoint' && referencedEndpointIds.has(n.id)) {
      lines.push(`  ${n.id}["🔌 ${n.name}"]:::endpoint`);
    }
  }

  for (const e of callsEdges) {
    lines.push(`  ${e.source} -->|calls| ${e.target}`);
  }

  // Render exposures from endpoints to their parent repos
  const exposesEdges = graph.edges.filter(
    (e) => e.type === 'EXPOSES' && referencedEndpointIds.has(e.target),
  );
  for (const e of exposesEdges) {
    lines.push(`  ${e.target} -.->|exposed by| ${e.source}`);
  }

  return lines.join('\n');
}

/**
 * Formats the graph as a human/LLM-readable markdown guide.
 */
export function generateGraphMarkdownContent(graph: WorkspaceGraph): string {
  const repoNodes = graph.nodes.filter((n) => n.type === 'repo');
  const mermaid = buildMermaidDiagram(graph);

  const lines: string[] = [
    `# Workspace Architecture Graph — ${graph.workspaceId}`,
    '',
    '> **Token-Efficient Architecture Guide**: This file defines the entities, dependencies,',
    '> and API call relationships of your multi-repository workspace. Use this map to navigate',
    '> relationships without having to read through all repository directories.',
    '',
    '## Workspace Relations Diagram',
    '',
    '```mermaid',
    mermaid,
    '```',
    '',
    '## 📦 Repositories',
    '',
  ];

  for (const repo of repoNodes) {
    lines.push(`### ${repo.name}`);
    lines.push(`- **Path**: \`${repo.metadata.path}\``);
    if (repo.metadata.techStack) {
      const ts = repo.metadata.techStack;
      lines.push(`- **Languages**: ${ts.languages.join(', ')}`);
      if (ts.frameworks.length > 0) {
        lines.push(`- **Frameworks**: ${ts.frameworks.join(', ')}`);
      }
    }
    
    // Dependencies
    const deps = graph.edges
      .filter((e) => e.source === repo.id && e.target.startsWith('package:'))
      .map((e) => {
        const pkgNode = graph.nodes.find((n) => n.id === e.target);
        return pkgNode ? `\`${pkgNode.name}\` (${pkgNode.metadata.manager})` : '';
      })
      .filter(Boolean);

    if (deps.length > 0) {
      lines.push(`- **Dependencies**: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? ` (+${deps.length - 10} more)` : ''}`);
    }

    // Exposed APIs
    const exposed = graph.edges
      .filter((e) => e.source === repo.id && e.target.startsWith('endpoint:'))
      .map((e) => {
        const ep = graph.nodes.find((n) => n.id === e.target);
        return ep ? `\`${ep.name}\`` : '';
      })
      .filter(Boolean);

    if (exposed.length > 0) {
      lines.push(`- **Exposed APIs**: ${exposed.slice(0, 5).join(', ')}${exposed.length > 5 ? ` (+${exposed.length - 5} more)` : ''}`);
    }

    // API calls made
    const calls = graph.edges
      .filter((e) => e.source === repo.id && e.type === 'CALLS')
      .map((e) => {
        const ep = graph.nodes.find((n) => n.id === e.target);
        return ep ? `\`${ep.name}\` (exposed by \`${ep.id.split(':')[1]}\`)` : '';
      })
      .filter(Boolean);

    if (calls.length > 0) {
      lines.push(`- **Calls Endpoints**: ${calls.join(', ')}`);
    }
    
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Builds the graph, writes `nexusflow-graph.json` and `nexusflow-graph.md` to workspace root.
 */
export async function generateWorkspaceGraphFiles(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  try {
    const graph = await buildWorkspaceGraph(ctx, workspacePath);
    
    // Write JSON file
    const jsonPath = path.join(workspacePath, 'nexusflow-graph.json');
    await fs.writeFile(jsonPath, JSON.stringify(graph, null, 2), 'utf-8');

    // Write MD file
    const mdPath = path.join(workspacePath, 'nexusflow-graph.md');
    const mdContent = generateGraphMarkdownContent(graph);
    await fs.writeFile(mdPath, mdContent, 'utf-8');

    console.log('  ✔ Generated Workspace Architecture Graph (nexusflow-graph.json / nexusflow-graph.md)');
  } catch (error: any) {
    console.error('  ✖ Failed to generate workspace architecture graph:', error.message);
  }
}
