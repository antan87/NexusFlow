import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import { loadFeatureConfig } from '../core/workspace.js';
import { ReviewLoopOrchestrator } from '../agent/ReviewLoop.js';

export async function reviewCommand(options: { task?: string }): Promise<void> {
  console.log(chalk.bold.cyan('\n🔍 NexusFlow — Agentic Code Review Loop\n'));

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (!cwdFeature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists in this directory or a parent.'));
    return;
  }

  const taskPrompt = options.task || await input({
    message: 'Describe the task for the implementer agent:',
    validate: (value) => value.trim().length > 0 || 'Task cannot be empty',
  });

  const orchestrator = new ReviewLoopOrchestrator(cwdFeature.workspacePath);
  const taskId = `task-${Date.now()}`;
  
  await orchestrator.startLoop(taskId, taskPrompt);
}
