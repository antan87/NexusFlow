import * as fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import { runCli } from 'repomix';
import { loadFeatureConfig } from './workspace.js';

export interface PackResult {
  outputPath: string;
  totalFiles: number;
  totalCharacters: number;
  fileSize: number;
}

/**
 * Packs all repositories in a workspace into a single, compressed XML file using Repomix.
 */
export async function packWorkspace(
  workspacePath: string,
  options: { compress?: boolean } = {}
): Promise<PackResult> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace not found at ${workspacePath}`);
  }

  const compress = options.compress !== false; // default true
  const outputPath = path.join(workspacePath, 'nexusflow-context.xml');
  
  // Use a write stream to avoid buffering huge workspaces in memory
  const outStream = createWriteStream(outputPath, { encoding: 'utf-8' });
  
  outStream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  outStream.write(`<workspace id="${feature.id}">\n`);
  outStream.write(`  <description><![CDATA[${feature.description}]]></description>\n`);
  outStream.write('  <repositories>\n');
  
  let totalFilesCount = 0;
  let totalCharsCount = 0;

  for (const repoPath of feature.repos) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(workspacePath, repoName);

    try {
      await fs.access(worktreePath);
    } catch {
      continue;
    }

    const tempXmlPath = path.join(workspacePath, `temp-repomix-${repoName}.xml`);

    try {
      // Run repomix programmatically inside the worktree directory
      const result = await runCli(['.'], worktreePath, {
        style: 'xml',
        output: tempXmlPath,
        compress,
        quiet: true,
      });

      if (result && result.packResult) {
        totalFilesCount += result.packResult.totalFiles;
        totalCharsCount += result.packResult.totalCharacters;
      }

      outStream.write(`    <repository name="${repoName}">\n`);
      
      // Stream output XML directly to avoid memory limits
      await pipeline(
        createReadStream(tempXmlPath, { encoding: 'utf-8' }),
        outStream,
        { end: false }
      );
      
      outStream.write('\n    </repository>\n');
    } catch (error: any) {
      console.error(`Error packing repository ${repoName}:`, error.message);
    } finally {
      // Clean up temporary XML file
      try {
        await fs.unlink(tempXmlPath);
      } catch {
        // ignore
      }
    }
  }

  outStream.write('  </repositories>\n');
  outStream.write('</workspace>\n');
  outStream.end();

  // Wait for stream to finish writing
  await new Promise<void>((resolve, reject) => {
    outStream.on('finish', resolve);
    outStream.on('error', reject);
  });

  const stats = await fs.stat(outputPath);

  return {
    outputPath,
    totalFiles: totalFilesCount,
    totalCharacters: totalCharsCount,
    fileSize: stats.size,
  };
}

