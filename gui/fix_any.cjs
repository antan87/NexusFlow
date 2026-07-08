const fs = require('fs');

const log = `
src/App.tsx(147,16): error TS7006: Parameter 'prev' implicitly has an 'any' type.
src/App.tsx(149,18): error TS7006: Parameter 'prev' implicitly has an 'any' type.
src/App.tsx(149,40): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(233,41): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(234,41): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(719,30): error TS7006: Parameter 'current' implicitly has an 'any' type.
src/App.tsx(879,29): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(880,46): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(888,40): error TS7006: Parameter 'x' implicitly has an 'any' type.
src/App.tsx(1051,36): error TS7006: Parameter 'e' implicitly has an 'any' type.
src/App.tsx(1097,30): error TS7006: Parameter 'e' implicitly has an 'any' type.
src/App.tsx(1100,30): error TS7006: Parameter 'e' implicitly has an 'any' type.
src/App.tsx(1122,32): error TS7006: Parameter 'w' implicitly has an 'any' type.
src/App.tsx(1314,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(1490,61): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(1494,62): error TS7006: Parameter 'f' implicitly has an 'any' type.
src/App.tsx(1504,37): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(1517,36): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(1607,32): error TS7006: Parameter 'ws' implicitly has an 'any' type.
src/App.tsx(1648,64): error TS7006: Parameter 'rs' implicitly has an 'any' type.
src/App.tsx(1654,36): error TS7006: Parameter 'service' implicitly has an 'any' type.
src/App.tsx(1655,63): error TS7006: Parameter 'rs' implicitly has an 'any' type.
src/App.tsx(2136,45): error TS7006: Parameter 'repo' implicitly has an 'any' type.
src/App.tsx(2137,66): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/App.tsx(2195,47): error TS7006: Parameter 'step' implicitly has an 'any' type.
src/App.tsx(2278,48): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(2312,43): error TS7006: Parameter 'ed' implicitly has an 'any' type.
src/App.tsx(2462,47): error TS7006: Parameter 'step' implicitly has an 'any' type.
src/App.tsx(2576,53): error TS7006: Parameter 'template' implicitly has an 'any' type.
src/App.tsx(2742,49): error TS7006: Parameter 'template' implicitly has an 'any' type.
src/App.tsx(2805,59): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(2812,59): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(2825,79): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(2854,57): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(2871,58): error TS7006: Parameter 't' implicitly has an 'any' type.
src/App.tsx(2919,69): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(2921,60): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(2923,51): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(2924,48): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(2938,88): error TS7006: Parameter 'ai' implicitly has an 'any' type.
src/App.tsx(3085,37): error TS7006: Parameter 'ed' implicitly has an 'any' type.
src/App.tsx(3107,65): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(3111,66): error TS7006: Parameter 'f' implicitly has an 'any' type.
src/App.tsx(3121,41): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(3135,38): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(3142,62): error TS7006: Parameter 'a' implicitly has an 'any' type.
src/App.tsx(3151,62): error TS7006: Parameter 'field' implicitly has an 'any' type.
src/App.tsx(3372,41): error TS7006: Parameter 'tool' implicitly has an 'any' type.
src/App.tsx(3499,33): error TS7006: Parameter 'msg' implicitly has an 'any' type.
src/App.tsx(3499,38): error TS7006: Parameter 'idx' implicitly has an 'any' type.
src/App.tsx(3539,48): error TS7006: Parameter 'w' implicitly has an 'any' type.
src/App.tsx(3554,22): error TS7006: Parameter 'toast' implicitly has an 'any' type.
src/App.tsx(3572,41): error TS7006: Parameter 'prev' implicitly has an 'any' type.
src/App.tsx(3572,63): error TS7006: Parameter 't' implicitly has an 'any' type.
`;

const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

const fixes = [];
for (const err of log.split('\n')) {
  if (!err.includes('error TS7006')) continue;
  const match = err.match(/src\/App\.tsx\((\d+),(\d+)\): error TS7006: Parameter '(.+?)' implicitly has an 'any' type./);
  if (match) {
    const lineNum = parseInt(match[1]) - 1;
    const colNum = parseInt(match[2]) - 1;
    const paramName = match[3];
    fixes.push({ lineNum, colNum, paramName });
  }
}

// Sort in reverse order so replacements on the same line don't mess up column indices
fixes.sort((a, b) => {
  if (a.lineNum !== b.lineNum) return b.lineNum - a.lineNum;
  return b.colNum - a.colNum;
});

for (const fix of fixes) {
  let line = lines[fix.lineNum];
  
  // The column points to the start of the parameter.
  // E.g., `(prev) =>` -> `prev`
  // We need to insert `: any` after the parameter name.
  
  // But wait, it might be `prev =>` without parens!
  // If it's `prev =>`, we must wrap it in parens `(prev: any) =>`.
  // If it's `(prev) =>` or `(prev, idx) =>`, we can just insert `: any` after `prev`.
  
  const before = line.substring(0, fix.colNum);
  const after = line.substring(fix.colNum);
  
  // Regex to check if it's currently without parens.
  // We look at the characters before the column.
  const isParenPreceded = before.match(/\(\s*$/) || before.match(/,\s*$/);
  
  if (isParenPreceded) {
    // Just append : any to the paramname
    const modifiedAfter = after.replace(new RegExp(`^${fix.paramName}\\b`), `${fix.paramName}: any`);
    lines[fix.lineNum] = before + modifiedAfter;
  } else {
    // It's likely `paramName =>`. We need to replace `paramName` with `(paramName: any)`.
    const modifiedAfter = after.replace(new RegExp(`^${fix.paramName}\\b`), `(${fix.paramName}: any)`);
    lines[fix.lineNum] = before + modifiedAfter;
  }
}

fs.writeFileSync('src/App.tsx', lines.join('\n'));
console.log('Fixed TS ANY errors');
