/**
 * @module commands/adapter
 * CLI commands for managing storage adapters.
 *
 * Usage:
 *   nexusflow adapter list               # List all available adapters
 *   nexusflow adapter use <name>          # Switch active adapter (prompts for config)
 *   nexusflow adapter info <name>         # Show adapter details and current settings
 *   nexusflow adapter init <name>         # Scaffold a new adapter plugin project
 */

import chalk from 'chalk';
import type { StorageAdapterMeta } from '../core/ports/storage.js';
import { input, confirm } from '@inquirer/prompts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { listStorageProviders, getStorageProvider } from '../core/adapters/registry.js';
import { loadConfig, saveConfig } from '../core/config.js';
import { BRAND_NAME, CLI_NAME, PRIMARY_CONFIG_DIR_NAME, GITHUB_REPO_URL, ENGINE_NPM_PACKAGE } from '../core/constants.js';

/**
 * Lists all registered storage adapters in a formatted table.
 */
export async function adapterListCommand(): Promise<void> {
  const config = await loadConfig();
  const activeName = config.storageProvider || 'local';
  const adapters = listStorageProviders();

  console.log(chalk.bold.cyan('\n📦 Available Storage Adapters\n'));

  // Table header
  const nameW = 18;
  const dispW = 22;
  const actW = 8;
  console.log(
    chalk.dim('  ') +
    chalk.bold('Name'.padEnd(nameW)) +
    chalk.bold('Display Name'.padEnd(dispW)) +
    chalk.bold('Active'.padEnd(actW)) +
    chalk.bold('Description')
  );
  console.log(chalk.dim('  ' + '─'.repeat(nameW + dispW + actW + 40)));

  for (const adapter of adapters) {
    const isActive = adapter.name === activeName;
    const activeMarker = isActive ? chalk.green('  ✔') : '   ';
    const configCount = adapter.configFields.length;
    const configHint = configCount > 0 ? chalk.dim(` (${configCount} settings)`) : '';

    console.log(
      '  ' +
      chalk.white(adapter.name.padEnd(nameW)) +
      chalk.cyan(adapter.displayName.padEnd(dispW)) +
      activeMarker.padEnd(actW) +
      chalk.gray(adapter.description) +
      configHint
    );
  }
  console.log();
}

/**
 * Shows detailed information about a specific adapter.
 */
export async function adapterInfoCommand(adapterName: string): Promise<void> {
  const config = await loadConfig();
  const activeName = config.storageProvider || 'local';

  let meta: StorageAdapterMeta;
  try {
    meta = getStorageProvider(adapterName).meta;
  } catch {
    console.error(chalk.red(`\n✖ Adapter "${adapterName}" is not registered.\n`));
    const adapters = listStorageProviders();
    console.log(chalk.dim(`  Available: ${adapters.map(a => a.name).join(', ')}`));
    return;
  }

  console.log(chalk.bold.cyan(`\n📦 Adapter: ${meta.displayName}\n`));
  console.log(`  ${chalk.bold('Name:')}        ${meta.name}`);
  console.log(`  ${chalk.bold('Active:')}      ${meta.name === activeName ? chalk.green('Yes') : 'No'}`);
  console.log(`  ${chalk.bold('Description:')} ${meta.description}`);

  if (meta.configFields.length > 0) {
    console.log(`\n  ${chalk.bold('Configuration Fields:')}`);
    const currentSettings = config.adapterConfig?.[meta.name] ?? {};

    for (const field of meta.configFields) {
      const currentValue = currentSettings[field.key];
      const defaultStr = field.default !== undefined ? chalk.dim(` (default: ${String(field.default)})`) : '';
      const requiredStr = field.required ? chalk.yellow(' *required') : '';
      const valueStr = currentValue !== undefined ? chalk.green(String(currentValue)) : chalk.dim('not set');

      console.log(`    ${chalk.white(field.label)} [${field.key}]${requiredStr}${defaultStr}`);
      console.log(`      ${chalk.dim(field.description || '')}`);
      console.log(`      Current: ${valueStr}`);
    }
  } else {
    console.log(chalk.dim('\n  No configuration needed.'));
  }
  console.log();
}

/**
 * Switches the active adapter and prompts for any required configuration.
 */
export async function adapterUseCommand(adapterName: string): Promise<void> {
  let provider;
  try {
    provider = getStorageProvider(adapterName);
  } catch {
    console.error(chalk.red(`\n✖ Adapter "${adapterName}" is not registered.\n`));
    const adapters = listStorageProviders();
    console.log(chalk.dim(`  Available: ${adapters.map(a => a.name).join(', ')}`));
    return;
  }

  const config = await loadConfig();
  const meta = provider.meta;
  const existingSettings = config.adapterConfig?.[meta.name] ?? {};
  const newSettings: Record<string, unknown> = { ...existingSettings };

  // Prompt for each config field
  if (meta.configFields.length > 0) {
    console.log(chalk.bold.cyan(`\n⚙️  Configure ${meta.displayName}\n`));

    for (const field of meta.configFields) {
      const currentValue = existingSettings[field.key];
      const defaultValue = currentValue !== undefined ? String(currentValue) : (field.default !== undefined ? String(field.default) : undefined);

      if (field.type === 'boolean') {
        const result = await confirm({
          message: field.label + (field.description ? chalk.dim(` — ${field.description}`) : ''),
          default: defaultValue === 'true' || field.default === true,
        });
        newSettings[field.key] = result;
      } else {
        const result = await input({
          message: field.label + (field.description ? chalk.dim(` — ${field.description}`) : ''),
          default: defaultValue,
          validate: (val) => {
            if (field.required && !val.trim()) return `${field.label} is required`;
            return true;
          },
        });

        if (field.type === 'number') {
          newSettings[field.key] = Number(result);
        } else {
          newSettings[field.key] = result;
        }
      }
    }
  }

  // Save config
  if (!config.adapterConfig) {
    config.adapterConfig = {};
  }
  config.adapterConfig[meta.name] = newSettings;
  config.storageProvider = meta.name;
  await saveConfig(config);

  // Apply configuration
  if (provider.configure) {
    provider.configure(newSettings);
  }

  console.log(chalk.green(`\n✔ Activated '${meta.displayName}' adapter.\n`));
}

/**
 * Scaffolds a new adapter plugin project.
 */
export async function adapterInitCommand(adapterName: string): Promise<void> {
  const targetDir = path.resolve(adapterName);

  try {
    await fs.access(targetDir);
    console.error(chalk.red(`\n✖ Directory "${adapterName}" already exists.\n`));
    return;
  } catch {}

  console.log(chalk.bold.cyan(`\n🔧 Scaffolding adapter: ${adapterName}\n`));

  await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });

  // package.json
  const pkg = {
    name: `nexusflow-${adapterName}`,
    version: '1.0.0',
    type: 'module',
    main: 'dist/index.js',
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
    },
    peerDependencies: {
      '@mrpatronz/nexusflow': '>=0.2.0',
    },
    devDependencies: {
      typescript: '^5.0.0',
    },
  };
  await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      declaration: true,
    },
    include: ['src/**/*'],
  };
  await fs.writeFile(path.join(targetDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf8');

  // src/index.ts — starter adapter
  const indexContent = `/**
 * ${BRAND_NAME} Storage Adapter: ${adapterName}
 *
 * Implement the StoragePort interface to create a custom storage backend.
 * See: ${GITHUB_REPO_URL}#adapters
 */

import type { StoragePort, StorageAdapterMeta, Plugin } from '${ENGINE_NPM_PACKAGE}';
// If the above import fails, use relative path to ${CLI_NAME}'s type definitions.

class ${toPascalCase(adapterName)}Adapter implements StoragePort {
  readonly meta: StorageAdapterMeta = {
    name: '${adapterName}',
    displayName: '${toTitleCase(adapterName)}',
    description: 'A custom ${BRAND_NAME} storage adapter.',
    configFields: [
      // Add your configuration fields here, e.g.:
      // { key: 'endpoint', label: 'API Endpoint', type: 'string', required: true, description: 'URL of the storage API' },
    ],
  };

  configure(settings: Record<string, unknown>): void {
    // Read your adapter-specific settings here
  }

  // ── Workspace (feature) layer ────────────────────────────

  async writeWorkspaceFile(workspacePath: string, featureId: string, filename: string, content: string): Promise<void> {
    throw new Error('Not implemented yet');
  }

  async readWorkspaceFile(workspacePath: string, featureId: string, filename: string): Promise<string> {
    throw new Error('Not implemented yet');
  }

  async workspaceFileExists(workspacePath: string, featureId: string, filename: string): Promise<boolean> {
    return false;
  }

  resolveWorkspaceFileUrl(workspacePath: string, featureId: string, filename: string): string {
    return '';
  }

  // ── Base (repo) layer ────────────────────────────────────

  async writeBaseFile(workspacePath: string, repoName: string, filename: string, content: string): Promise<void> {
    throw new Error('Not implemented yet');
  }

  async readBaseFile(workspacePath: string, repoName: string, filename: string): Promise<string> {
    throw new Error('Not implemented yet');
  }

  async baseFileExists(workspacePath: string, repoName: string, filename: string): Promise<boolean> {
    return false;
  }

  resolveBaseFileUrl(workspacePath: string, repoName: string, filename: string): string {
    return '';
  }
}

const plugin: Plugin = {
  name: '${CLI_NAME}-${adapterName}',
  version: '1.0.0',
  register(context) {
    context.registerStorageProvider('${adapterName}', new ${toPascalCase(adapterName)}Adapter());
  },
};

export default plugin;
`;
  await fs.writeFile(path.join(targetDir, 'src', 'index.ts'), indexContent, 'utf8');

  // README.md
  const readme = `# ${BRAND_NAME} ${adapterName} Storage Adapter

A custom storage adapter for [${BRAND_NAME}](${GITHUB_REPO_URL}).

## Development

\`\`\`bash
npm install
npm run build
\`\`\`

## Usage

Add to your ${BRAND_NAME} config (\`~/${PRIMARY_CONFIG_DIR_NAME}/config.json\`):

\`\`\`json
{
  "plugins": ["./path/to/${CLI_NAME}-${adapterName}/dist/index.js"],
  "storageProvider": "${adapterName}"
}
\`\`\`

Or activate via CLI:

\`\`\`bash
${CLI_NAME} adapter use ${adapterName}
\`\`\`
`;
  await fs.writeFile(path.join(targetDir, 'README.md'), readme, 'utf8');

  console.log(chalk.green('  ✔ Created package.json'));
  console.log(chalk.green('  ✔ Created tsconfig.json'));
  console.log(chalk.green('  ✔ Created src/index.ts (starter adapter)'));
  console.log(chalk.green('  ✔ Created README.md'));
  console.log(chalk.bold.green(`\n✅ Adapter scaffolded at ${targetDir}\n`));
  console.log(chalk.dim('  Next steps:'));
  console.log(chalk.dim(`    cd ${adapterName}`));
  console.log(chalk.dim('    npm install'));
  console.log(chalk.dim('    # Implement the StoragePort methods in src/index.ts'));
  console.log(chalk.dim('    npm run build'));
  console.log();
}

function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function toTitleCase(str: string): string {
  return str.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
