const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

const view3Start = lines.findIndex(l => l.includes('{/* View 3: Settings View */}'));

let view3End = view3Start;
let braceCount = 0;
let started = false;
for(let i=view3Start; i<lines.length; i++) {
  if (lines[i].includes('<div')) braceCount++;
  if (lines[i].includes('</div')) braceCount--;
  if (braceCount > 0) started = true;
  if (started && braceCount === 0) {
    view3End = i;
    break;
  }
}

const newLines = [];
for (let i = 0; i < lines.length; i++) {
  if (i === view3Start) {
    newLines.push(`            {/* View 3: Settings View */}
            {view === 'settings' && config && (
              <SettingsPage
                config={config}
                setConfig={setConfig}
                saveAppConfig={saveAppConfig}
                localLlmEnabled={localLlmEnabled}
                setLocalLlmEnabled={setLocalLlmEnabled}
              />
            )}`);
    i = view3End;
  } else {
    newLines.push(lines[i]);
  }
}

// remove unused imports
for (let i = 0; i < 30; i++) {
  if (newLines[i]) {
    newLines[i] = newLines[i].replace('Terminal, ', '');
    newLines[i] = newLines[i].replace('FolderOpen, ', '');
    newLines[i] = newLines[i].replace('ArrowLeft, ', '');
    newLines[i] = newLines[i].replace('Search, ', '');
    newLines[i] = newLines[i].replace('Trash2, ', '');
    newLines[i] = newLines[i].replace('CheckCircle, ', '');
  }
}

// Clean up unused functions safely
const finalLines = [];
let skip = false;
for (let j = 0; j < newLines.length; j++) {
  if (newLines[j] && newLines[j].includes('const handleToggleRepo = (repo: RepoInfo) => {')) {
    skip = true;
  } else if (skip && newLines[j] && newLines[j].includes('};') && newLines[j-1] && newLines[j-1].includes('setSelectedRepos')) {
    skip = false;
    continue;
  }
  
  if (newLines[j] && newLines[j].includes('const handleToggleAI = (aiName: string) => {')) {
    skip = true;
  } else if (skip && newLines[j] && newLines[j].includes('};') && newLines[j-1] && newLines[j-1].includes('setSelectedAI')) {
    skip = false;
    continue;
  }

  if (newLines[j] && newLines[j].includes('const filteredRepos = repos.filter((r) =>')) {
    skip = true;
  } else if (skip && newLines[j] && newLines[j].includes(');') && newLines[j-1] && newLines[j-1].includes('r.name.toLowerCase().includes')) {
    skip = false;
    continue;
  }

  if (!skip) {
    finalLines.push(newLines[j]);
  }
}

fs.writeFileSync('src/App.tsx', finalLines.join('\n'));
console.log('App.tsx Settings replaced and unused cleaned');
