import { afterEach, beforeEach, expect, it } from 'vitest';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDevelopmentSkills, repositoryRoot } from './check-development-skills.mjs';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'development-skills-'));
  await cp(path.join(repositoryRoot, 'resources/skills'), path.join(root, 'resources/skills'), { recursive: true });
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
