const fs = require('fs');
const states = JSON.parse(fs.readFileSync('states.json', 'utf-8'));

let interfaceLines = [];
let initialLines = [];
let setterLines = [];

for (const state of states) {
  const match = state.match(/const \[(.+?),\s*(.+?)\] = useState(<(.+?)>)?\((.*)\);?/);
  if (!match) continue;
  
  const [_, name, setterName, typeRaw, typeGroup, initialValueRaw] = match;
  
  let type = typeGroup || 'any';
  if (initialValueRaw === 'false' || initialValueRaw === 'true') type = 'boolean';
  if (initialValueRaw === "''" || initialValueRaw === '""') type = 'string';
  if (initialValueRaw === '0') type = 'number';
  
  interfaceLines.push(`  ${name}: ${type};`);
  interfaceLines.push(`  ${setterName}: (value: ${type} | ((prev: ${type}) => ${type})) => void;`);
  
  let initialValue = initialValueRaw.replace(/;$/, '');
  if (!initialValue) initialValue = "''";
  
  initialLines.push(`  ${name}: ${initialValue},`);
  setterLines.push(`  ${setterName}: (value) => set((state) => ({ ${name}: typeof value === 'function' ? (value as any)(state.${name}) : value })),`);
}

const storeFile = `import { create } from 'zustand';
import type { RepoInfo, DetectedAI, DetectedEditor, NexusFlowConfig, StorageAdapterMeta, Feature, WorkspaceStatus, ServiceConfig, OrchestrationDetection, RunningService, Toast } from '../types.js';

export interface AppState {
${interfaceLines.join('\n')}
}

export const useAppStore = create<AppState>((set) => ({
${initialLines.join('\n')}
${setterLines.join('\n')}
}));
`;

fs.writeFileSync('src/store/useAppStore.ts', storeFile);
console.log('Store updated with functional updaters');
