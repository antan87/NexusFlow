import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkDevelopmentSkills, readDevelopmentSkills, repositoryRoot } from './check-development-skills.mjs';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'development-skills-'));
  await cp(path.join(repositoryRoot, 'resources/skills'), path.join(root, 'resources/skills'), { recursive: true });
  await cp(path.join(repositoryRoot, 'resources/workflows'), path.join(root, 'resources/workflows'), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('loads complete portable packages including their support files for catalog installation', async () => {
  const skills = await readDevelopmentSkills(root);
  expect(skills).toHaveLength(3);
  for (const skill of skills) {
    expect(skill.references.length).toBeGreaterThan(0);
    expect(skill.content).not.toContain('name:');
    expect(skill.title).toBeTruthy();
  }
});

it('rejects invalid metadata anywhere in the bundle before returning installable packages', async () => {
  await writeFile(path.join(root, 'resources/skills/contextspace-verify-release/SKILL.md'), '---\nname: wrong-skill\ndescription: A different package\n---\nInstructions');
  await expect(readDevelopmentSkills(root)).rejects.toThrow('Invalid skill metadata');
});

it('rejects unexpected package payloads instead of silently dropping them on installation', async () => {
  await writeFile(path.join(root, 'resources/skills/nexusflow-dev/unexpected.sh'), 'echo unexpected');
  await expect(readDevelopmentSkills(root)).rejects.toThrow('Unsupported skill entry');
});

it('fails on missing linked guidance rather than silently installing a broken reference', async () => {
  await appendFile(path.join(root, 'resources/skills/nexusflow-dev/SKILL.md'), '\nRead [missing guidance](references/missing.md).\n');
  await expect(checkDevelopmentSkills(root)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects invalid skill entrypoint when SKILL.md is not a regular file', async () => {
  const entrypoint = path.join(root, 'resources/skills/nexusflow-dev/SKILL.md');
  await rm(entrypoint);
  await cp(path.join(root, 'resources/skills/nexusflow-dev/references'), entrypoint, { recursive: true });
  await expect(readDevelopmentSkills(root)).rejects.toThrow('Invalid skill entrypoint: nexusflow-dev');
});

it('fails when SKILL.md is missing from a maintained skill directory', async () => {
  await rm(path.join(root, 'resources/skills/nexusflow-dev/SKILL.md'));
  await expect(readDevelopmentSkills(root)).rejects.toMatchObject({ code: 'ENOENT' });
});

