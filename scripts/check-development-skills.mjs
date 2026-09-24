#!/usr/bin/env node
import { open, readFile, readdir, lstat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillIds = ['nexusflow-dev', 'nexusflow-lifecycle', 'contextspace-verify-release'];

/** Read the entire maintained bundle before installation writes anything. */
export async function readDevelopmentSkills(root = repositoryRoot) {
  const packages = [];
  for (const id of skillIds) {
    const base = path.join(root, 'resources/skills', id);
    if (!(await lstat(base)).isDirectory()) throw new Error(`Skill directory is not a regular directory: ${id}`);
    const markdownPath = path.join(base, 'SKILL.md');
    let handle;
    let raw;
    try {
      handle = await open(markdownPath, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Invalid skill entrypoint: ${id}`);
      raw = await handle.readFile('utf8');
    } catch (error) {
      if (error.code === 'EISDIR') {
        throw new Error(`Invalid skill entrypoint: ${id}`);
      }
      throw error;
    } finally {
      await handle?.close();
    }
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`Missing frontmatter: ${id}`);
    const metadata = load(match[1]);
    if (metadata?.name !== id || !metadata?.description?.trim()) throw new Error(`Invalid skill metadata: ${id}`);
    const references = [];
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.name === 'SKILL.md') continue;
      if (entry.name !== 'references' || !entry.isDirectory()) throw new Error(`Unsupported skill entry: ${id}/${entry.name}`);
      for (const reference of await readdir(path.join(base, 'references'), { withFileTypes: true })) {
        if (!reference.isFile() || !reference.name.endsWith('.md')) throw new Error(`Invalid reference: ${id}/${reference.name}`);
        references.push({ name: reference.name, content: await readFile(path.join(base, 'references', reference.name), 'utf8') });
      }
    }
    packages.push({ id, name: id, description: metadata.description, metadata: metadata.metadata,
      title: metadata.metadata?.contextspace?.title, category: metadata.metadata?.contextspace?.category,
      tags: metadata.metadata?.contextspace?.tags,
      content: match[2].trim(), references, base });
  }
  return packages;
}

export async function checkDevelopmentSkills(root = repositoryRoot) {
  const packages = await readDevelopmentSkills(root);
  const documents = packages.flatMap((skill) => [
    { file: path.join(skill.base, 'SKILL.md'), content: skill.content },
    ...skill.references.map((ref) => ({ file: path.join(skill.base, 'references', ref.name), content: ref.content })),
  ]);
  for (const entry of await readdir(path.join(root, 'resources/workflows'))) {
    if (entry.endsWith('.md')) documents.push({ file: path.join(root, 'resources/workflows', entry),
      content: await readFile(path.join(root, 'resources/workflows', entry), 'utf8') });
  }
  const checkedCommands = new Set();
  const helpByPath = new Map();
  for (const { file, content } of documents) {
    if (/implementation_plan\.md|\b\d+\+? (?:unit tests|test files)\b/.test(content)) {
      throw new Error(`Duplicate plan or fixed test count in ${file}`);
    }
    for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(link[1])) continue;
      const target = path.resolve(path.dirname(file), link[1].split('#')[0]);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Reference leaves the repository: ${link[1]}`);
      if (!(await lstat(target)).isFile()) throw new Error(`Reference is not a regular file: ${link[1]}`);
    }
    for (const code of content.matchAll(/`([^`\n]+)`/g)) {
      const command = code[1];
      if (checkedCommands.has(command)) continue;
      if (command.startsWith('ctxspace ') || command.startsWith('node dist/index.js ')) {
        const words = command.replace(/^(?:ctxspace|node dist\/index\.js) /, '').split(/\s+/);
        const commandPath = words.slice(0, words.findIndex((word) => word.startsWith('-')) < 0 ? words.length : words.findIndex((word) => word.startsWith('-')));
        const key = commandPath.join(' ');
        let help = helpByPath.get(key);
        if (!help) {
          // Help must describe the shipped CLI, unaffected by installed user plugins.
          const configDir = await mkdtemp(path.join(tmpdir(), 'contextspace-skill-help-'));
          try {
            await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ plugins: [] }));
            const result = spawnSync(process.execPath, [path.join(root, 'dist/index.js'), ...commandPath, '--help'], {
              cwd: root, encoding: 'utf8', timeout: 30_000,
              env: { ...process.env, CONTEXTSPACE_HOME: configDir, NEXUSFLOW_HOME: configDir },
            });
            if (result.error || result.status !== 0 || !result.stdout.includes('Usage:')) throw new Error(`Documented CLI command failed: ${command}: ${result.error?.message ?? (result.stderr || `exit ${result.status}`)}`);
            help = result.stdout;
            helpByPath.set(key, help);
          } finally { await rm(configDir, { recursive: true, force: true }); }
        }
        for (const flag of words.filter((word) => word.startsWith('--') && word !== '--help')) {
          if (!new RegExp(`${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[ ,=\\n]|$)`).test(help)) throw new Error(`Unknown documented flag ${flag}: ${command}`);
        }
        checkedCommands.add(command);
      } else if (command.startsWith('npm ')) {
        const words = command.split(/\s+/);
        const prefix = words.indexOf('--prefix');
        const directory = prefix >= 0 ? words[prefix + 1] : '.';
        const manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
        const script = words[1] === 'run' ? words[2] : words[1];
        if (!manifest.scripts?.[script]) throw new Error(`Unknown package script: ${command}`);
        checkedCommands.add(command);
      }
    }
  }
  return { skills: packages.length, documents: documents.length, commands: checkedCommands.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log('Development skill checks passed:', await checkDevelopmentSkills()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
