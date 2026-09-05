import * as path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { createWorkspace } from '../src/core/workspace.js';
import { analyzeAllRepos } from '../src/analyzers/index.js';
import { generateContextFiles } from '../src/generators/index.js';

async function main() {
  const config = await loadConfig();
  const repoPath = 'C:\\Users\\patro\\dev\\easyagent_container';
  
  console.log('Creating Workspace 1: feat/rate-limiting-standard (Local LLM DISABLED)');
  const ws1Path = path.join(config.workspacesDir, 'feat/rate-limiting-standard');
  const feature1 = {
    id: 'feat/rate-limiting-standard',
    branchName: 'feat/rate-limiting-standard',
    description: 'Implement rate limiting and connection pooling',
    repos: [repoPath],
    assistants: ['claude'],
    workspacePath: ws1Path,
    createdAt: new Date().toISOString(),
    localLlmEnabled: false,
  };
  const repos1 = [{ name: 'easyagent_container', path: path.join(ws1Path, 'easyagent_container'), isGitRepo: true, defaultBranch: 'master' }];
  
  await createWorkspace(feature1, [{ name: 'easyagent_container', path: repoPath, isGitRepo: true, defaultBranch: 'master' }]);
  const analysis1 = await analyzeAllRepos(repos1);
  const ctx1 = { feature: feature1, repos: repos1, analysis: analysis1 };
  await generateContextFiles(ctx1, ['claude'], ws1Path);
  console.log('✅ Workspace 1 created at:', ws1Path);

  console.log('\nCreating Workspace 2: feat/rate-limiting-local-llm (Local LLM ENABLED)');
  const ws2Path = path.join(config.workspacesDir, 'feat/rate-limiting-local-llm');
  const feature2 = {
    id: 'feat/rate-limiting-local-llm',
    branchName: 'feat/rate-limiting-local-llm',
    description: 'Implement rate limiting and connection pooling',
    repos: [repoPath],
    assistants: ['claude'],
    workspacePath: ws2Path,
    createdAt: new Date().toISOString(),
    localLlmEnabled: true,
  };
  const repos2 = [{ name: 'easyagent_container', path: path.join(ws2Path, 'easyagent_container'), isGitRepo: true, defaultBranch: 'master' }];
  
  await createWorkspace(feature2, [{ name: 'easyagent_container', path: repoPath, isGitRepo: true, defaultBranch: 'master' }]);
  const analysis2 = await analyzeAllRepos(repos2);
  const ctx2 = { feature: feature2, repos: repos2, analysis: analysis2, localLlm: config.localLlm };
  await generateContextFiles(ctx2, ['claude'], ws2Path);
  console.log('✅ Workspace 2 created at:', ws2Path);
  
  console.log('\nBoth test workspaces are ready!');
}

main().catch(console.error);
