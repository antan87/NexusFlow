#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkDevelopmentSkills, readDevelopmentSkills } from './check-development-skills.mjs';
import { saveSkill, getWorkspaceSkillsConfig, saveWorkspaceSkillsConfig } from '../dist/utils/skills-catalog.js';
import { loadFeatureConfig } from '../dist/core/workspace.js';

// Catalog updates use the existing locked, atomic API; materialization is a separate refresh.
const { values } = parseArgs({ options: { global: { type: 'boolean' }, workspace: { type: 'string' } } });
if (!values.global) throw new Error('Specify --global to install/update the three maintained catalog skills. Optionally use --workspace <path> to enable them there.');
const workspace = values.workspace ? path.resolve(values.workspace) : undefined;
if (workspace && !await loadFeatureConfig(workspace)) throw new Error('The requested workspace has no valid manifest.');
await checkDevelopmentSkills();
const skills = await readDevelopmentSkills();
for (const skill of skills) {
  await saveSkill(skill, { scope: 'global' });
  console.log(`Installed ${skill.id}`);
}
if (workspace) {
  const current = await getWorkspaceSkillsConfig(workspace);
  const ids = skills.map((skill) => skill.id);
  await saveWorkspaceSkillsConfig(workspace, { ...current,
    enabledSkills: [...new Set([...current.enabledSkills, ...ids])],
    disabledSkills: (current.disabledSkills ?? []).filter((id) => !ids.includes(id)),
  }, current.revision ?? 0);
  console.log(`Enabled skills in ${workspace}. Run ctxspace refresh for that workspace to regenerate assistant views.`);
}
