/**
 * @module commands/open
 * Re-opens an existing NexusFlow workspace in an editor.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { select, confirm, search } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces } from '../core/workspace.js';
import { detectEditors } from '../utils/detect-editors.js';
import { openInEditor } from '../utils/open-editor.js';
import { promptSelectEditor } from '../utils/prompts.js';
import { findSessions } from '../utils/session-finder.js';

/**
 * Lets the user pick an existing workspace and open it in an editor.
 */
export async function openCommand(): Promise<void> {
  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('\nNo workspaces found.'));
    console.log(chalk.dim('  Run "nexusflow create" to create your first workspace.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n📂 Open Workspace\n'));

  // Let user pick a workspace
  const selected = await search({
    message: 'Search and select a workspace to open:',
    source: async (input) => {
      const query = (input || '').toLowerCase();
      const filtered = workspaces.filter(
        (ws) =>
          ws.branchName.toLowerCase().includes(query) ||
          ws.workspacePath.toLowerCase().includes(query)
      );
      return filtered.map((ws) => ({
        name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos, ${ws.assistants.join(', ')})`)}`,
        value: ws.workspacePath,
      }));
    },
  });

  // Let user pick an editor
  const detectedEditors = await detectEditors();
  const editor = await promptSelectEditor(detectedEditors);

  if (editor) {
    try {
      await openInEditor(editor.command, selected);
      console.log(chalk.green(`\n✅ Opened ${selected} in ${editor.name}\n`));
    } catch {
      console.log(chalk.yellow(`\n⚠️  Could not open editor. Navigate manually:`));
      console.log(chalk.dim(`  cd "${selected}"\n`));
    }
  } else {
    console.log(chalk.dim(`\n  To navigate: cd "${selected}"\n`));
  }

  // ── Start AI Assistant Session ──────────────────────────────────────
  const loadedFeature = workspaces.find((ws) => ws.workspacePath === selected);
  if (loadedFeature && loadedFeature.assistants.length > 0) {
    const assistant = loadedFeature.assistants[0];
    const confirmStart = await confirm({
      message: `Do you want to start a session with ${assistant} inside the workspace now?`,
      default: true,
    });

    if (confirmStart) {
      console.log(chalk.cyan(`\n🚀 Starting ${assistant} session inside workspace...\n`));

      const sessions = await findSessions(selected, loadedFeature.repos);
      let cmdName = 'agy';
      let cmdArgs: string[] = [];

      if (assistant === 'claude') {
        cmdName = 'claude';
      } else if (assistant === 'codex') {
        cmdName = 'codex';
      } else if (assistant === 'copilot') {
        cmdName = 'copilot';
      }

      if (sessions.length > 0 && sessions[0].assistant === assistant) {
        const latestSessionId = sessions[0].id;
        if (assistant === 'antigravity') {
          cmdArgs = ['--conversation', latestSessionId];
        } else if (assistant === 'claude') {
          cmdArgs = ['--resume', latestSessionId];
        } else if (assistant === 'codex') {
          cmdArgs = ['resume', latestSessionId];
        } else if (assistant === 'copilot') {
          cmdArgs = ['--resume', latestSessionId];
        }
      } else {
        if (assistant === 'antigravity') {
          cmdArgs = ['--continue'];
        } else if (assistant === 'claude') {
          cmdArgs = ['--resume'];
        } else if (assistant === 'codex') {
          cmdArgs = ['resume'];
        } else if (assistant === 'copilot') {
          cmdArgs = ['--resume'];
        }
      }

      try {
        await execa(cmdName, cmdArgs, {
          cwd: selected,
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
        console.log(chalk.green(`\n👋 Exited ${assistant} session.`));
      } catch {
        const fullCmd = [cmdName, ...cmdArgs].join(' ');
        console.log(
          chalk.yellow(`\n⚠️  Could not start ${assistant}. Please start it manually:\n  ${chalk.dim(`cd "${selected}" && ${fullCmd}`)}`)
        );
      }
    }
  }
}
