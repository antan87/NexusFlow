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
    // We found the last </div>
    // Check next lines for ')}'
    let end = i;
    for(let j=i+1; j<i+5; j++) {
      if (lines[j].trim() === ')}') {
        end = j;
        break;
      }
    }
    view3End = end;
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

fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('App.tsx Settings replaced properly!');
