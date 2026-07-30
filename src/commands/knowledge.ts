/**
 * @module commands/knowledge
 * `nexusflow knowledge` — capture and manage workspace learnings so they
 * actually accumulate instead of leaving the knowledge files empty.
 */

import chalk from 'chalk';
import { checkbox, select } from '@inquirer/prompts';

import { getWorkspaceRepos } from '../utils/multi-git.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import {
  addWorkspaceKnowledge,
  addBaseKnowledge,
  readWorkspaceKnowledge,
  readBaseKnowledge,
  parseKnowledgeEntries,
  promoteKnowledge,
  MAX_ENTRY_CHARS,
  type KnowledgeEntryType,
  type ParsedKnowledgeEntry,
} from '../core/knowledge.js';

const VALID_TYPES: KnowledgeEntryType[] = ['decision', 'gotcha', 'progress', 'assumption', 'question'];
/** Types that exist in the per-repo base knowledge file. */
const PROMOTABLE_TYPES: KnowledgeEntryType[] = ['decision', 'gotcha', 'assumption'];

interface AddOptions {
  type: string;
  message: string;
  title?: string;
  repo?: string;
}

interface ShowOptions {
  section?: string;
  repo?: string;
}

interface PromoteOptions {
  repo?: string;
  type?: string;
  message?: string;
  move?: boolean;
  all?: boolean;
}

/** Validates a `--type` value, returning it typed or `null` (after printing an error). */
function parseType(type: string): KnowledgeEntryType | null {
  if (!VALID_TYPES.includes(type as KnowledgeEntryType)) {
    console.error(chalk.red(`✖ Invalid --type "${type}". Use one of: ${VALID_TYPES.join(', ')}`));
    return null;
  }
  return type as KnowledgeEntryType;
}

/**
 * Rejects an over-long entry, explaining how to shorten it.
 *
 * The rule itself lives in `core/knowledge.ts` so every write path shares it;
 * this only front-runs it to fail before the workspace prompt and to print the
 * advice across several dim lines instead of one long error.
 *
 * @returns True when the message is within {@link MAX_ENTRY_CHARS}.
 */
export function checkEntryLength(message: string): boolean {
  const length = (message ?? '').replace(/\s+/g, ' ').trim().length;
  if (length <= MAX_ENTRY_CHARS) return true;

  console.error(
    chalk.red(`✖ Entry is ${length} characters; the limit is ${MAX_ENTRY_CHARS}.`),
  );
  console.log(chalk.dim('  This file is read by an assistant and only grows, so an entry has to be a'));
  console.log(chalk.dim('  rule, not a write-up. State what to do and why in one or two sentences.'));
  console.log(chalk.dim('  Split genuinely separate findings into separate entries, and put long'));
  console.log(chalk.dim('  material in a document the entry points to.'));
  return false;
}

/** Collapses an entry's markdown to a single line for list display. */
function oneLine(text: string, max = 72): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`;
}

/** Extracts a single `## ` section's text from a markdown document. */
function sliceSection(content: string, name: string): string | null {
  const lines = content.split(/\r?\n/);
  const target = name.trim().toLowerCase();
  const start = lines.findIndex((l) => {
    const m = l.match(/^##\s+(.*)$/);
    return m ? m[1].trim().toLowerCase().includes(target) : false;
  });
  if (start === -1) return null;

  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/**
 * `knowledge add` — append a timestamped learning to the workspace knowledge
 * file, or (with `--repo`) to a repo's persistent base knowledge.
 */
export async function knowledgeAddCommand(workspaceArg: string | undefined, options: AddOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n🧠 NexusFlow — Add Knowledge\n'));

  const type = parseType(options.type);
  if (!type) return;

  if (!options.message || !options.message.trim()) {
    console.error(chalk.red('✖ A message is required (-m "...").'));
    return;
  }

  // Checked before the workspace prompt, so an over-long entry fails immediately
  // rather than after picking a workspace.
  if (!checkEntryLength(options.message)) return;

  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;

  if (options.repo) {
    if (!PROMOTABLE_TYPES.includes(type)) {
      console.error(chalk.red(`✖ '${type}' entries cannot be stored in base knowledge (use decision, gotcha, or assumption).`));
      return;
    }
    const repos = await getWorkspaceRepos(workspacePath);
    if (!repos.some((r) => r.name === options.repo)) {
      console.error(chalk.red(`✖ Repository "${options.repo}" is not in this workspace.`));
      console.log(chalk.dim(`  Available: ${repos.map((r) => r.name).join(', ')}`));
      return;
    }
    const res = await addBaseKnowledge(workspacePath, options.repo, {
      type,
      message: options.message,
      title: options.title,
    });
    console.log(chalk.green(`  ✔ Added to ${chalk.bold(options.repo)} base knowledge under "${res.section}"`));
    console.log(chalk.dim(`  ${res.location}`));
    return;
  }

  const res = await addWorkspaceKnowledge(workspacePath, {
    type,
    message: options.message,
    title: options.title,
  });
  console.log(
    chalk.green(`  ✔ Recorded under "${res.section}"${res.createdFile ? ' (created knowledge file)' : ''}`),
  );
  console.log(chalk.dim(`  ${res.location}`));
}

/** `knowledge show` — print the workspace knowledge file (or a repo's base file). */
export async function knowledgeShowCommand(workspaceArg: string | undefined, options: ShowOptions): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;

  const content = options.repo
    ? await readBaseKnowledge(workspacePath, options.repo)
    : await readWorkspaceKnowledge(workspacePath);

  if (!content) {
    console.log(
      chalk.yellow(
        options.repo
          ? `No base knowledge recorded for ${options.repo} yet.`
          : 'No workspace knowledge recorded yet.',
      ),
    );
    return;
  }

  if (options.section) {
    const section = sliceSection(content, options.section);
    if (!section) {
      console.log(chalk.yellow(`Section matching "${options.section}" not found.`));
      return;
    }
    console.log(`\n${section}\n`);
    return;
  }

  console.log(`\n${content}\n`);
}

/**
 * `knowledge promote` — copy (or move) workspace learnings into a repo's
 * persistent base knowledge so they survive across features.
 */
export async function knowledgePromoteCommand(
  workspaceArg: string | undefined,
  options: PromoteOptions,
): Promise<void> {
  console.log(chalk.bold.cyan('\n🧠 NexusFlow — Promote Knowledge to Base\n'));

  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;

  const repos = await getWorkspaceRepos(workspacePath);
  if (repos.length === 0) {
    console.log(chalk.yellow('No repositories in this workspace.\n'));
    return;
  }

  // Direct, non-interactive promotion of a supplied message.
  if (options.message) {
    if (!options.repo) {
      console.error(chalk.red('✖ --repo is required when promoting a message with -m.'));
      return;
    }
    if (!repos.some((r) => r.name === options.repo)) {
      console.error(chalk.red(`✖ Repository "${options.repo}" is not in this workspace.`));
      return;
    }
    const type = parseType(options.type ?? 'decision');
    if (!type) return;
    if (!PROMOTABLE_TYPES.includes(type)) {
      console.error(chalk.red(`✖ '${type}' entries cannot be promoted to base knowledge.`));
      return;
    }
    if (!checkEntryLength(options.message)) return;
    const res = await addBaseKnowledge(workspacePath, options.repo, { type, message: options.message });
    console.log(chalk.green(`  ✔ Promoted to ${chalk.bold(options.repo)} base knowledge under "${res.section}"`));
    console.log(chalk.dim(`  ${res.location}`));
    return;
  }

  // Otherwise, promote existing workspace entries.
  const content = await readWorkspaceKnowledge(workspacePath);
  if (!content) {
    console.log(chalk.yellow('No workspace knowledge to promote yet.\n'));
    return;
  }

  const promotable = parseKnowledgeEntries(content).filter(
    (e) => e.type && PROMOTABLE_TYPES.includes(e.type),
  );
  if (promotable.length === 0) {
    console.log(chalk.yellow('No promotable entries (decisions, gotchas, assumptions) found.\n'));
    return;
  }

  const repoName =
    options.repo && repos.some((r) => r.name === options.repo)
      ? options.repo
      : await select({
          message: "Promote into which repository's base knowledge?",
          choices: repos.map((r) => ({ name: r.name, value: r.name })),
        });

  let selected: ParsedKnowledgeEntry[] = promotable;
  if (!options.all) {
    const indices = await checkbox({
      message: 'Select learnings to promote:',
      choices: promotable.map((e, i) => ({ name: `[${e.type}] ${oneLine(e.text)}`, value: i })),
    });
    selected = indices.map((i) => promotable[i]);
  }

  if (selected.length === 0) {
    console.log(chalk.yellow('Nothing selected.\n'));
    return;
  }

  const mode: 'copy' | 'move' = options.move ? 'move' : 'copy';
  const res = await promoteKnowledge(workspacePath, { repoName, entries: selected, mode });
  console.log(
    chalk.green(
      `  ✔ Promoted ${res.promotedCount} learning${res.promotedCount === 1 ? '' : 's'} to ${chalk.bold(repoName)} (${mode})`,
    ),
  );
  console.log(chalk.dim(`  ${res.baseLocation}`));
}
