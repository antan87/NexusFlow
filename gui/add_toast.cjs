const fs = require('fs');
let types = fs.readFileSync('src/types.ts', 'utf-8');
if (!types.includes('interface Toast')) {
  types += `\nexport interface Toast {\n  id: string;\n  title: string;\n  message?: string;\n  type: 'success' | 'error' | 'info' | 'warning';\n}\n`;
  fs.writeFileSync('src/types.ts', types);
  console.log('Added Toast to types.ts');
}
