/**
 * @module commands/init
 * Initializes the NexusFlow configuration.
 */

import chalk from 'chalk';
import { input, confirm, select } from '@inquirer/prompts';
import path from 'node:path';
import os from 'node:os';

import { loadConfig, saveConfig, ensureConfigDir } from '../core/config.js';
import { scanSystemSpecs } from '../utils/system-scanner.js';

/**
 * Initializes NexusFlow configuration interactively.
 * Creates ~/.nexusflow/config.json with user preferences.
 */
export async function initCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n⚙️  NexusFlow — Initialize\n'));

  await ensureConfigDir();
  const existing = await loadConfig();

  // ── 1. Basic Directories ──────────────────────────────────────────────
  const devDir = await input({
    message: 'Development directory (where your repos live):',
    default: existing.devDir || path.join(os.homedir(), 'dev'),
  });

  const workspacesDir = await input({
    message: 'Workspaces directory (where feature workspaces are created):',
    default: existing.workspacesDir || path.join(devDir, 'workspaces'),
  });

  const scanDepth = await input({
    message: 'How deep to scan for repos (directory levels):',
    default: String(existing.scanDepth || 2),
    validate: (value: string) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 10) return 'Enter a number between 1 and 10';
      return true;
    },
  });

  // ── 2. Local AI Scanner & Config ──────────────────────────────────────
  console.log(chalk.cyan('\nProbing system hardware for local AI capabilities...'));
  const specs = await scanSystemSpecs();
  console.log(chalk.dim(`  RAM Detected: ${specs.totalRamGb} GB`));
  console.log(chalk.dim(`  GPU Detected: ${specs.gpuName}`));
  console.log(chalk.dim(`  Recommended model: ${chalk.bold(specs.recommendedModel)}`));

  const enableLlm = await confirm({
    message: 'Enable Local AI Co-processor (Ollama/LM Studio)?',
    default: existing.localLlm?.enabled ?? false,
  });

  let localLlmConfig = existing.localLlm || {
    enabled: false,
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: specs.recommendedModel,
  };

  if (enableLlm) {
    const provider = await select({
      message: 'Local AI Provider:',
      choices: [
        { name: 'Ollama', value: 'ollama' as const },
        { name: 'OpenAI-Compatible (e.g. LM Studio, Llama.cpp)', value: 'openai-compatible' as const },
      ],
      default: existing.localLlm?.provider || 'ollama',
    });

    const defaultEndpoint = provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234';
    const endpoint = await input({
      message: 'Local AI Endpoint URL:',
      default: existing.localLlm?.endpoint || defaultEndpoint,
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          return 'Endpoint must start with http:// or https://';
        }
        try {
          new URL(trimmed);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });

    const model = await input({
      message: `Local LLM Model Name (Recommended: ${specs.recommendedModel}):`,
      default: existing.localLlm?.model || specs.recommendedModel,
    });

    localLlmConfig = {
      enabled: true,
      provider,
      endpoint: endpoint.trim(),
      model: model.trim(),
    };
  } else {
    localLlmConfig.enabled = false;
  }

  const config = {
    ...existing,
    devDir: devDir.trim(),
    workspacesDir: workspacesDir.trim(),
    scanDepth: parseInt(scanDepth, 10),
    localLlm: localLlmConfig,
  };

  await saveConfig(config);

  console.log(chalk.green('\n✅ Configuration saved!\n'));
  console.log(chalk.dim('  Config file: ~/.nexusflow/config.json'));
  console.log(chalk.dim(`  Dev dir:     ${config.devDir}`));
  console.log(chalk.dim(`  Workspaces:  ${config.workspacesDir}`));
  console.log(chalk.dim(`  Scan depth:  ${config.scanDepth}`));
  console.log(chalk.dim(`  Local AI:    ${config.localLlm.enabled ? `Enabled (${config.localLlm.provider}, model: ${config.localLlm.model})` : 'Disabled'}`));
  console.log(chalk.dim('\n  Run "nexusflow create" to create your first workspace.\n'));
}
