import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runCli } from 'repomix';
import { loadFeatureConfig } from './workspace.js';
import { loadConfig } from './config.js';

export interface PackResult {
  outputPath: string;
  outputPaths?: string[];
  totalFiles: number;
  totalCharacters: number;
  fileSize: number;
}

/**
 * Packs all repositories in a workspace into individual XML files using Repomix.
 */
export async function packWorkspace(
  workspacePath: string,
  options: { compress?: boolean } = {}
): Promise<PackResult> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace not found at ${workspacePath}`);
  }

  const config = await loadConfig();
  const ignorePatterns = (config.excludePatterns || []).join(',');
  const compress = options.compress !== false; // default true

  let totalFilesCount = 0;
  let totalCharsCount = 0;
  let totalFileSize = 0;
  const outputPaths: string[] = [];

  for (const repoPath of feature.repos) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(workspacePath, repoName);

    try {
      await fs.access(worktreePath);
    } catch {
      continue;
    }

    const outputXmlPath = path.join(workspacePath, `nexusflow-context-${repoName}.xml`);
    const instructionsPath = path.join(worktreePath, 'repomix-instruction.md');

    // Generate dynamic repomix-instruction.md for this repo
    const mapPath = path.join(workspacePath, `nexusflow-map-${repoName}.md`).replace(/\\/g, '/');
    const planPath = path.join(workspacePath, `nexusflow-plan.md`).replace(/\\/g, '/');
    
    const instructionsContent = [
      `# AI Assistant Instructions for ${repoName}`,
      '',
      `This XML file contains the packed codebase for the repository \`${repoName}\` in the workspace \`${feature.id}\`.`,
      '',
      `When working with this code, you MUST follow these guidelines:`,
      `1. **Explore Locally**: Do not rely on this XML snapshot as the source of truth for edits. Always use your native search, grep, and view tools on the live files in: \`${worktreePath.replace(/\\/g, '/')}\`.`,
      `2. **Read the Architecture Map**: Before implementing any changes, read the generated map file at: [nexusflow-map-${repoName}.md](file:///${mapPath}) to understand its layout, API endpoints, test commands, and detected usage patterns.`,
      `3. **Follow the Implementation Order**: See the phased plan at: [nexusflow-plan.md](file:///${planPath}) to avoid cross-repo dependency build ordering issues.`,
      `4. **Git Operations**: Run git commands (status, add, commit) strictly inside the repository subdirectories (e.g. \`cd ${repoName} && git commit -m "..."\`), NOT in the workspace root.`,
      '',
    ].join('\n');

    try {
      // Write instructions to repo worktree root so Repomix picks it up and appends it at the end
      await fs.writeFile(instructionsPath, instructionsContent, 'utf-8');

      // Run repomix programmatically
      const result = await runCli(['.'], worktreePath, {
        style: 'xml',
        output: outputXmlPath,
        compress,
        quiet: true,
        ignore: ignorePatterns,
      });

      if (result && result.packResult) {
        totalFilesCount += result.packResult.totalFiles;
        totalCharsCount += result.packResult.totalCharacters;
      }

      const stats = await fs.stat(outputXmlPath);
      totalFileSize += stats.size;
      outputPaths.push(outputXmlPath);

    } catch (error: any) {
      console.error(`Error packing repository ${repoName}:`, error.message);
    } finally {
      // Clean up the temporary instruction file from the repo's worktree
      try {
        await fs.unlink(instructionsPath);
      } catch {
        // ignore
      }
    }
  }

  return {
    outputPath: outputPaths[0] || '',
    outputPaths,
    totalFiles: totalFilesCount,
    totalCharacters: totalCharsCount,
    fileSize: totalFileSize,
  };
}
