const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Ensure useAppStore is imported
if (!content.includes('import { useAppStore }')) {
  // Find the first import line and insert right after it
  const firstImportMatch = content.match(/import .+?;\n/);
  if (firstImportMatch) {
    content = content.replace(firstImportMatch[0], firstImportMatch[0] + "import { useAppStore } from './store/useAppStore.js';\n");
  }
}

// Remove unused useState
content = content.replace("import React, { useState, useEffect, useRef } from 'react';", "import React, { useEffect, useRef } from 'react';");

const lines = content.split('\n');
const newLines = [];
let destructuredVars = [];

let inUseState = false;
let parenCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (line.includes('function AppInner() {')) {
    newLines.push(line);
    // Add the store line later
    newLines.push('  // ZUSTAND_INJECT');
    continue;
  }

  // Remove the inline interface Toast since it's now in types.ts
  if (line.includes('interface Toast {') && lines[i+1].includes('id: string;') && lines[i+2].includes('message: string;')) {
     // Skip the next 5 lines
     i += 5;
     continue;
  }

  if (!inUseState && line.trim().startsWith('const [') && line.includes('useState')) {
    // Parse variable names
    const match = line.match(/const \[(.+?),\s*(.+?)\] = useState/);
    if (match) {
      destructuredVars.push(match[1]);
      destructuredVars.push(match[2]);
    }
    
    inUseState = true;
  }

  if (inUseState) {
    // Comment it out
    newLines.push(`// ${line}`);
    
    // Check if we hit the end of the useState call
    parenCount += (line.match(/\(/g) || []).length;
    parenCount -= (line.match(/\)/g) || []).length;
    
    // Need to handle objects inside useState carefully, but since useState(...) ends with );
    if (line.trim().endsWith(');') || line.trim().endsWith(') ;') || (parenCount === 0 && line.trim().endsWith(']'))) {
       inUseState = false;
       parenCount = 0;
    }
  } else {
    newLines.push(line);
  }
}

// Replace injection point
const storeCall = `const state = useAppStore();\n  const { ${destructuredVars.join(', ')} } = state;`;
let finalContent = newLines.join('\n').replace('  // ZUSTAND_INJECT', `  ${storeCall}`);

fs.writeFileSync('src/App.tsx', finalContent);
console.log('App.tsx updated, import fixed');
