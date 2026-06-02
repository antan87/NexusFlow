import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
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
  
  const reposXmlData: { repoName: string; xmlContent: string }[] = [];
  
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

    // Build repomix arguments
    const args = ['repomix', '--style', 'xml', '--output', tempXmlPath];
    if (compress) {
      args.push('--compress');
    }

    try {
      // Run repomix inside the worktree directory
      await execa('npx', args, { cwd: worktreePath });

      // Read output XML
      const xmlContent = await fs.readFile(tempXmlPath, 'utf8');

      // Estimate file and character counts
      const fileMatches = xmlContent.match(/<file\s+path=/gi) || [];
      totalFilesCount += fileMatches.length;
      totalCharsCount += xmlContent.length;

      reposXmlData.push({
        repoName,
        xmlContent,
      });
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

  // Combine reposXmlData into a single XML structure
  const xmlLines: string[] = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlLines.push(`<workspace id="${feature.id}">`);
  xmlLines.push(`  <description><![CDATA[${feature.description}]]></description>`);
  xmlLines.push('  <repositories>');

  for (const repo of reposXmlData) {
    xmlLines.push(`    <repository name="${repo.repoName}">`);
    xmlLines.push(repo.xmlContent);
    xmlLines.push('    </repository>');
  }

  xmlLines.push('  </repositories>');
  xmlLines.push('</workspace>');
  xmlLines.push('');

  const outputXmlContent = xmlLines.join('\n');
  const outputPath = path.join(workspacePath, 'nexusflow-context.xml');
  await fs.writeFile(outputPath, outputXmlContent, 'utf-8');

  const stats = await fs.stat(outputPath);

  return {
    outputPath,
    totalFiles: totalFilesCount,
    totalCharacters: totalCharsCount,
    fileSize: stats.size,
  };
}
