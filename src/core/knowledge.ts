/**
 * @module core/knowledge
 * Single engine for capturing workspace/base knowledge, shared by the CLI
 * `knowledge` command, the dashboard server, and the MCP `add_knowledge` /
 * `promote_knowledge` tools.
 *
 * All file I/O routes through the active storage adapter (`core/storage.ts`)
 * so the local and central-vault backends keep working — the previous
 * direct-`fs` knowledge routes silently wrote to a file the generators never
 * read under vault adapters.
 *
 * The markdown helpers (`insertUnderHeading`, `formatEntry`,
 * `parseKnowledgeEntries`) are pure and section-aware: they insert under the
 * correct heading, tolerate leading YAML frontmatter (written by the removed
 * Obsidian adapter; such files still exist in user vaults) and CRLF, and
 * never destroy existing content.
 */

import * as path from 'node:path';

import { loadFeatureConfig } from './workspace.js';
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  workspaceFileExists,
  resolveWorkspaceFileUrl,
  readBaseFile,
  writeBaseFile,
  baseFileExists,
  resolveBaseFileUrl,
} from './storage.js';
import { buildBaseKnowledgeContent } from '../generators/index.js';

/** The knowledge filename used for both the workspace and base layers. */
const KNOWLEDGE_FILE = 'nexusflow-knowledge.md';

/** Categories of learning that can be captured. */
export type KnowledgeEntryType =
  | 'decision'
  | 'gotcha'
  | 'progress'
  | 'assumption'
  | 'question';

/** A learning to record. */
export interface KnowledgeEntry {
  type: KnowledgeEntryType;
  message: string;
  /** Short title, used for the heading of a `decision` entry. */
  title?: string;
  /** ISO timestamp; defaults to now. */
  timestamp?: string;
}

/** Result of writing a knowledge entry. */
export interface KnowledgeWriteResult {
  /** Storage-resolved location (adapter URL) of the file written. */
  location: string;
  /** The heading the entry landed under. */
  section: string;
  /** True when the file did not exist and was created. */
  createdFile: boolean;
}

/** A parsed existing entry, used when promoting learnings. */
export interface ParsedKnowledgeEntry {
  /** The `## ` section heading the entry was found under. */
  section: string;
  /** The category, or `null` when the section is not a recognized knowledge section. */
  type: KnowledgeEntryType | null;
  /** The raw markdown of the entry (a bullet line or a `### ` decision block). */
  text: string;
}

/** Options for {@link promoteKnowledge}. */
export interface PromoteOptions {
  repoName: string;
  entries: ParsedKnowledgeEntry[];
  /** `copy` (default) keeps the workspace entry; `move` replaces it with a note. */
  mode?: 'copy' | 'move';
}

/** Result of {@link promoteKnowledge}. */
export interface PromoteResult {
  promotedCount: number;
  baseLocation: string;
}

/**
 * Heading aliases per entry type for the workspace and base knowledge files.
 * The first alias is the canonical heading used when the section is missing.
 * `base: null` means the type is not promotable to base knowledge.
 */
const SECTION_ALIASES: Record<
  KnowledgeEntryType,
  { workspace: string[]; base: string[] | null }
> = {
  decision: {
    workspace: ['Architecture Decisions'],
    base: ['Architecture Decisions'],
  },
  gotcha: {
    workspace: ['Known Gotchas', 'Discovered Gotchas & Watch-outs', 'Discovered Gotchas'],
    base: ['Discovered Gotchas & Watch-outs', 'Known Gotchas', 'Discovered Gotchas'],
  },
  progress: {
    workspace: ['Implementation Progress'],
    base: null,
  },
  assumption: {
    workspace: ['Project Assumptions (verify with user)', 'Project Assumptions'],
    base: ['Coding Conventions & Invariants'],
  },
  question: {
    workspace: ['Clarifying Questions for the User', 'Clarifying Questions'],
    base: null,
  },
};

// ─── Pure markdown helpers ──────────────────────────────────────────────────

/** True for template placeholder lines that should be replaced by real content. */
function isPlaceholder(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^_\(.*\)_$/.test(t)) return true; // e.g. _(No gotchas recorded yet.)_
  if (/^-\s*None recorded yet\.?$/i.test(t)) return true;
  return false;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function truncateHeading(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max).trimEnd()}…`;
}

/**
 * Formats a {@link KnowledgeEntry} as the markdown snippet to insert.
 *
 * @param entry  - The entry to format.
 * @param _target - Reserved for target-specific formatting (currently identical).
 */
export function formatEntry(entry: KnowledgeEntry, _target: 'workspace' | 'base'): string {
  const date = (entry.timestamp ?? new Date().toISOString()).slice(0, 10);
  const msg = entry.message.trim();

  switch (entry.type) {
    case 'decision': {
      const heading = entry.title?.trim() ? entry.title.trim() : truncateHeading(msg);
      return `### ${date} — ${heading}\n**Decision:** ${msg}`;
    }
    case 'progress':
      return `- [x] ${date} — ${msg}`;
    case 'gotcha':
    case 'assumption':
    case 'question':
    default: {
      // Lead with the title when there is one, so the file stays skimmable: it
      // only grows, and a reader must be able to judge relevance from the first
      // few words rather than by reading every entry.
      //
      // Without a title, fall back to leading with the date. Deriving a label
      // from the message instead printed its first 60 characters twice — once as
      // the bold label and again in the body — which is pure waste in the one
      // file this project is trying to keep small.
      const title = entry.title?.trim();
      return title ? `- **${title}** (${date}) — ${msg}` : `- **${date}:** ${msg}`;
    }
  }
}

/**
 * Inserts `entryMarkdown` under the first `## ` heading matching any of
 * `headingAliases` (case-insensitive), stripping placeholder lines. When no
 * matching heading exists, a new section is appended at end-of-file using the
 * first alias. Existing content is never removed. CRLF line endings and a
 * leading YAML frontmatter block are preserved.
 *
 * @returns The updated markdown.
 */
export function insertUnderHeading(
  markdown: string,
  headingAliases: string[],
  entryMarkdown: string,
): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const aliasSet = new Set(headingAliases.map((a) => a.trim().toLowerCase()));

  // Find the target section heading.
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.*)$/);
    if (m && aliasSet.has(m[1].trim().toLowerCase())) {
      headingIdx = i;
      break;
    }
  }

  const entryLines = entryMarkdown.split(/\r?\n/);

  if (headingIdx === -1) {
    // Append a fresh section at end-of-file.
    const trimmed = lines.join(eol).replace(/\s+$/, '');
    const prefix = trimmed.length > 0 ? `${trimmed}${eol}${eol}` : '';
    return `${prefix}## ${headingAliases[0]}${eol}${eol}${entryLines.join(eol)}${eol}`;
  }

  // Determine the section body range: until the next h1/h2 or EOF.
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const before = lines.slice(0, headingIdx + 1);
  const after = lines.slice(sectionEnd);

  // Keep comments and real content; drop placeholders and trailing blanks.
  const body = lines.slice(headingIdx + 1, sectionEnd).filter((l) => !isPlaceholder(l));
  while (body.length > 0 && body[body.length - 1].trim() === '') {
    body.pop();
  }

  // One blank line between the heading (or existing content) and the new entry.
  const newSection = [...before, ...body, '', ...entryLines, ''];

  // Preserve a single blank line before the next section, if any.
  const tail = after.length > 0 ? [...after] : [];
  return [...newSection, ...tail].join(eol);
}

/** Reverse lookup: which entry type owns a given `## ` heading, if any. */
function sectionType(heading: string): KnowledgeEntryType | null {
  const h = heading.trim().toLowerCase();
  for (const [type, aliases] of Object.entries(SECTION_ALIASES) as [
    KnowledgeEntryType,
    { workspace: string[]; base: string[] | null },
  ][]) {
    const all = [...aliases.workspace, ...(aliases.base ?? [])];
    if (all.some((a) => a.toLowerCase() === h)) {
      return type;
    }
  }
  return null;
}

/**
 * Parses a knowledge markdown document into individual entries: bullet lines
 * and `### ` decision blocks, each tagged with its section and inferred type.
 * Placeholder and comment lines are ignored.
 */
export function parseKnowledgeEntries(markdown: string): ParsedKnowledgeEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: ParsedKnowledgeEntry[] = [];

  let currentSection = '';
  let currentType: KnowledgeEntryType | null = null;
  let decisionBuffer: string[] | null = null;

  const flushDecision = () => {
    if (decisionBuffer) {
      const text = decisionBuffer.join('\n').trim();
      if (text) entries.push({ section: currentSection, type: currentType, text });
      decisionBuffer = null;
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flushDecision();
      currentSection = h2[1].trim();
      currentType = sectionType(currentSection);
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushDecision();
      currentSection = '';
      currentType = null;
      continue;
    }

    if (line.startsWith('### ')) {
      flushDecision();
      decisionBuffer = [line];
      continue;
    }
    if (decisionBuffer) {
      decisionBuffer.push(line);
      continue;
    }

    const t = line.trim();
    if (t.startsWith('- ') && !isPlaceholder(line)) {
      entries.push({ section: currentSection, type: currentType, text: t });
    }
  }
  flushDecision();

  return entries;
}

// ─── Adapter-routed I/O ─────────────────────────────────────────────────────

async function resolveFeatureId(workspacePath: string): Promise<string> {
  const feature = await loadFeatureConfig(workspacePath);
  return feature?.id ?? path.basename(workspacePath);
}

/**
 * Longest a single entry may be.
 *
 * The knowledge file is read by an assistant and only grows. One workspace
 * reached 44 KB — about 11,000 tokens, twenty times its own auto-loaded context
 * — across 21 entries averaging 1,200 characters, because each was written as a
 * write-up rather than a rule. 300 characters fits a rule plus the reason it
 * exists; anything longer belongs in a document the entry links to.
 */
export const MAX_ENTRY_CHARS = 300;

/**
 * Validates an entry message and returns the exact string to store.
 *
 * Enforced here rather than in the CLI because every write path converges on
 * this function: `nexusflow knowledge add`, `knowledge promote`, the MCP
 * `knowledge` tool, and the HTTP endpoint. A cap that lived in the command
 * handler bound none of the others — including the MCP tool, which is how an
 * assistant records knowledge and so the very caller that produced the 44 KB.
 *
 * Returns the normalised message so the string that was measured is the string
 * that gets written; validating the trimmed form and storing the raw one let
 * surrounding whitespace and embedded newlines past the limit and broke the
 * one-entry-per-line shape the file's own header promises.
 */
function normaliseMessage(message: string): string {
  const normalised = (message ?? '').replace(/\s+/g, ' ').trim();

  if (!normalised) {
    throw new Error('Knowledge entry message cannot be empty.');
  }
  if (normalised.length > MAX_ENTRY_CHARS) {
    throw new Error(
      `Knowledge entry is ${normalised.length} characters; the limit is ${MAX_ENTRY_CHARS}. ` +
      'An entry has to be a rule, not a write-up: state what to do and why in one or two ' +
      'sentences, split separate findings into separate entries, and put long material in ' +
      'a document the entry points to.',
    );
  }

  return normalised;
}

/** Reads the workspace knowledge file, or `null` when it does not exist. */
export async function readWorkspaceKnowledge(workspacePath: string): Promise<string | null> {
  const featureId = await resolveFeatureId(workspacePath);
  if (!(await workspaceFileExists(workspacePath, featureId, KNOWLEDGE_FILE))) {
    return null;
  }
  return readWorkspaceFile(workspacePath, featureId, KNOWLEDGE_FILE);
}

/** Reads a repo's base knowledge file, or `null` when it does not exist. */
export async function readBaseKnowledge(
  workspacePath: string,
  repoName: string,
): Promise<string | null> {
  if (!(await baseFileExists(workspacePath, repoName, KNOWLEDGE_FILE))) {
    return null;
  }
  return readBaseFile(workspacePath, repoName, KNOWLEDGE_FILE);
}

/** Appends a formatted entry to the workspace knowledge file (creating it if missing). */
export async function addWorkspaceKnowledge(
  workspacePath: string,
  entry: KnowledgeEntry,
): Promise<KnowledgeWriteResult> {
  const checked: KnowledgeEntry = { ...entry, message: normaliseMessage(entry.message) };
  const featureId = await resolveFeatureId(workspacePath);
  const exists = await workspaceFileExists(workspacePath, featureId, KNOWLEDGE_FILE);
  const content = exists
    ? await readWorkspaceFile(workspacePath, featureId, KNOWLEDGE_FILE)
    : `# Workspace Knowledge — ${featureId}\n`;

  const aliases = SECTION_ALIASES[checked.type].workspace;
  const updated = insertUnderHeading(content, aliases, formatEntry(checked, 'workspace'));
  await writeWorkspaceFile(workspacePath, featureId, KNOWLEDGE_FILE, updated);

  return {
    location: resolveWorkspaceFileUrl(workspacePath, featureId, KNOWLEDGE_FILE),
    section: aliases[0],
    createdFile: !exists,
  };
}

/**
 * Inserts already-formatted markdown under a repo's base knowledge section for
 * the given type (creating the file if missing).
 */
async function insertIntoBase(
  workspacePath: string,
  repoName: string,
  type: KnowledgeEntryType,
  entryMarkdown: string,
): Promise<KnowledgeWriteResult> {
  const aliases = SECTION_ALIASES[type].base;
  if (!aliases) {
    throw new Error(`'${type}' entries cannot be stored in base (repo) knowledge.`);
  }
  const exists = await baseFileExists(workspacePath, repoName, KNOWLEDGE_FILE);
  const content = exists
    ? await readBaseFile(workspacePath, repoName, KNOWLEDGE_FILE)
    : buildBaseKnowledgeContent(repoName);

  const updated = insertUnderHeading(content, aliases, entryMarkdown);
  await writeBaseFile(workspacePath, repoName, KNOWLEDGE_FILE, updated);

  return {
    location: resolveBaseFileUrl(workspacePath, repoName, KNOWLEDGE_FILE),
    section: aliases[0],
    createdFile: !exists,
  };
}

/** Appends a formatted entry to a repo's base knowledge file (creating it if missing). */
export async function addBaseKnowledge(
  workspacePath: string,
  repoName: string,
  entry: KnowledgeEntry,
): Promise<KnowledgeWriteResult> {
  const checked: KnowledgeEntry = { ...entry, message: normaliseMessage(entry.message) };
  return insertIntoBase(workspacePath, repoName, checked.type, formatEntry(checked, 'base'));
}

/**
 * Promotes selected workspace learnings into a repo's persistent base
 * knowledge so they survive across features. Entries whose type is not
 * promotable (progress, question) are skipped. In `move` mode the source entry
 * in the workspace file is replaced with an auditable "promoted" note.
 */
export async function promoteKnowledge(
  workspacePath: string,
  options: PromoteOptions,
): Promise<PromoteResult> {
  const { repoName, entries, mode = 'copy' } = options;
  const promotable = entries.filter((e) => e.type && SECTION_ALIASES[e.type].base);

  let baseLocation = resolveBaseFileUrl(workspacePath, repoName, KNOWLEDGE_FILE);
  for (const e of promotable) {
    // Preserve the entry's original markdown rather than reformatting it.
    const res = await insertIntoBase(workspacePath, repoName, e.type!, e.text);
    baseLocation = res.location;
  }

  if (mode === 'move' && promotable.length > 0) {
    const featureId = await resolveFeatureId(workspacePath);
    if (await workspaceFileExists(workspacePath, featureId, KNOWLEDGE_FILE)) {
      let content = await readWorkspaceFile(workspacePath, featureId, KNOWLEDGE_FILE);
      const date = todayIso();
      for (const e of promotable) {
        content = content.replace(
          e.text,
          `- Promoted to ${repoName} base knowledge on ${date}.`,
        );
      }
      await writeWorkspaceFile(workspacePath, featureId, KNOWLEDGE_FILE, content);
    }
  }

  return { promotedCount: promotable.length, baseLocation };
}
