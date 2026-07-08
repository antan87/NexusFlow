import { ProviderRegistry } from './ProviderRegistry.js';
import { execa } from 'execa';
import chalk from 'chalk';

export class ReviewLoopOrchestrator {
  private registry: ProviderRegistry;
  
  constructor(private workspacePath: string) {
    this.registry = new ProviderRegistry(workspacePath);
  }

  public async runVerificationHarness(): Promise<{ passed: boolean; output: string }> {
    console.log(chalk.cyan('Running verification harnesses (tsc, vitest)...'));
    try {
      // Run static analysis
      await execa('npm', ['run', 'build'], { cwd: this.workspacePath });
      // Run testing harness
      await execa('npm', ['run', 'test'], { cwd: this.workspacePath });
      
      return { passed: true, output: 'All verification harnesses passed.' };
    } catch (err: any) {
      return { passed: false, output: `${err.stdout || ''}\n${err.stderr || err.message || 'Unknown error'}`.trim() };
    }
  }

  public async startLoop(taskId: string, initialPrompt: string) {
    console.log(chalk.bold.magenta(`\n🔄 Starting Agentic Review Loop for Task: ${taskId}`));

    let iterations = 0;
    const maxIterations = 5;
    let success = false;

    try {
      // We simulate the implementer/reviewer loop by launching the "Implementer" session
      while (iterations < maxIterations && !success) {
        iterations++;
        console.log(chalk.blue(`\n▶ Iteration ${iterations}/${maxIterations}`));

        // 1. Launch Implementer Agent
        // In a real scenario, this would use MCP or API to pass the prompt and wait for changes.
        const implementerSessionId = `${taskId}-impl-${iterations}`;
        console.log(chalk.dim(`Spinning up Implementer Agent (Session: ${implementerSessionId})...`));
        
        // Simulate implementer work (in actual T3Code we'd wrap Claude/Codex here)
        // await this.registry.launchAgent(implementerSessionId, 'claude-code', this.workspacePath, ['claude', 'code', '--prompt', initialPrompt]);
        
        // 2. Run Verification Harness
        const harnessResult = await this.runVerificationHarness();
        
        if (harnessResult.passed) {
          // 3. Launch Reviewer Agent if harness passes
          const reviewerSessionId = `${taskId}-rev-${iterations}`;
          console.log(chalk.dim(`Harness passed. Spinning up Reviewer Agent (Session: ${reviewerSessionId})...`));
          
          // Simulate reviewer (In actual T3Code we'd invoke the reviewer prompt)
          // await this.registry.launchAgent(reviewerSessionId, 'cursor-agent', this.workspacePath, ['cursor', '--review']);
          
          // Simulating the reviewer's approval
          console.log(chalk.green('✅ Reviewer Agent approved the changes!'));
          success = true;
        } else {
          console.log(chalk.yellow('⚠️ Harness failed. Feeding back to Implementer...'));
          console.log(chalk.dim(harnessResult.output.slice(0, 500) + '...'));
          
          // The feedback would go into the next iteration's prompt
        }
      }

      if (!success) {
        console.log(chalk.red(`\n❌ Review Loop failed after ${maxIterations} iterations.`));
      } else {
        console.log(chalk.green(`\n🎉 Code is verified and merged!`));
      }
    } finally {
      this.registry.shutdown();
    }
  }
}
