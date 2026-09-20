import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  ChangesetSymbolIndex,
} from './changesetSymbolIndex.ts';
import {
  registerCrossFileEditorOpener,
} from './changesetModelStore.ts';
import type { DiffHunkAction } from '../types.ts';
import {
  computeEditorUri,
  getEditorLabel,
  getEditorCommand,
} from '../adapters/ExternalDiffLauncher.ts';

// ─── 1. MASSIVE INPUT STRESS TEST (5,000+ LINES) ──────────────────────────────
test('Massive 5,000+ line input tokenizes within budget without memory or stack overflow', () => {
  const index = new ChangesetSymbolIndex();
  const lineCount = 5500;
  const lines: string[] = [];

  // Generate 5,500 lines: every 10 lines, emit a symbol declaration
  let expectedSymbolCount = 0;
  for (let i = 1; i <= lineCount; i++) {
    if (i % 50 === 0) {
      lines.push(`export class StressClass_${i} {`);
      expectedSymbolCount++;
    } else if (i % 25 === 0) {
      lines.push(`export interface IStress_${i} { id: string; }`);
      expectedSymbolCount++;
    } else if (i % 10 === 0) {
      lines.push(`export function stressFn_${i}(param: number): number { return param * 2; }`);
      expectedSymbolCount++;
    } else {
      lines.push(`  // Line ${i} filler statement;`);
    }
  }

  const bigContent = lines.join('\n');

  const start = performance.now();
  const symbols = index.indexFile('stress-repo', 'src/generated/bigModule.ts', bigContent);
  const elapsed = performance.now() - start;

  assert.equal(symbols.length, expectedSymbolCount);
  assert.ok(elapsed < 150, `Indexing took ${elapsed}ms, exceeding 150ms budget`);

  // Verify first, middle, and last symbol line numbers
  const first = symbols[0];
  assert.equal(first.name, 'stressFn_10');
  assert.equal(first.lineNumber, 10);

  const last = symbols[symbols.length - 1];
  assert.equal(last.lineNumber, 5500);

  // Fast map lookup in huge index
  const lookupStart = performance.now();
  const found = index.findDefinitions('stressFn_10');
  const lookupElapsed = performance.now() - lookupStart;

  assert.equal(found.length, 1);
  assert.equal(found[0].lineNumber, 10);
  assert.ok(lookupElapsed < 5, `Lookup took ${lookupElapsed}ms, exceeding 5ms budget`);
});

// ─── 2. PATHOLOGICAL & MALFORMED CODE INPUTS ──────────────────────────────────
test('Handles pathological inputs: empty files, whitespace-only, binary, syntax errors', () => {
  const index = new ChangesetSymbolIndex();

  // Empty content
  const emptySymbols = index.indexFile('repo', 'src/empty.ts', '');
  assert.equal(emptySymbols.length, 0);

  // Whitespace-only content
  const wsSymbols = index.indexFile('repo', 'src/ws.ts', '   \n\r\n\t  \n  ');
  assert.equal(wsSymbols.length, 0);

  // Binary/null bytes content
  const binaryContent = '\0\0\x01\x02\xFF\xFE\x00\x07\n\0export function nullByte() {}\n\0';
  const binSymbols = index.indexFile('repo', 'src/binary.ts', binaryContent);
  assert.ok(binSymbols.length >= 0); // Must not throw or crash

  // Truncated declarations & syntax errors
  const malformedTS = `
export function
export class
export interface
export type
const = () =>
export const brokenArrow = () =>
function brokenNoParens {
class
type Incomplete =
`;
  const malformedSymbols = index.indexFile('repo', 'src/malformed.ts', malformedTS);
  assert.ok(Array.isArray(malformedSymbols));
  // brokenArrow should still match as a function
  const arrow = malformedSymbols.find((s) => s.name === 'brokenArrow');
  assert.ok(arrow);
  assert.equal(arrow.kindLabel, 'function');
});

// ─── 3. REDOS RESISTANCE & ULTRA-LONG LINES ───────────────────────────────────
test('Resists ReDoS attacks and handles ultra-long lines (10,000+ chars) gracefully', () => {
  const index = new ChangesetSymbolIndex();

  // Attack 1: 20,000 spaces followed by partial pattern
  const longSpaces = ' '.repeat(20000) + 'export function attack1() {}';
  // Attack 2: 10,000 colons and spaces in type annotation
  const evilType = 'const x: ' + 'Array<number> | '.repeat(1000) + 'string = () => {};';
  // Attack 3: massive repetitive tokens
  const repetitive = 'export const ' + 'a'.repeat(5000) + ' = () => 1;';

  const pathologicalContent = [longSpaces, evilType, repetitive].join('\n');

  const start = performance.now();
  const symbols = index.indexFile('repo', 'src/redos.ts', pathologicalContent);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 100, `ReDoS check took ${elapsed}ms, possible catastrophic backtracking`);
  assert.ok(symbols.length >= 1);
});

// ─── 4. COMPLEX & MODERN DECLARATIONS IN TYPESCRIPT ───────────────────────────
test('Extracts complex TypeScript declarations: generics, generators, defaults', () => {
  const index = new ChangesetSymbolIndex();

  const code = `
export default function defaultFn() {}
export default class DefaultClass {}
export function* idGenerator() { yield 1; }
export async function* streamGenerator() { yield 2; }
export const arrowSimple = (x: number) => x * 2;
export const arrowNoParens = x => x * 2;
export const arrowDestruct = ({ a, b }: { a: number; b: number }) => a + b;
export interface ExtendedInterface extends BaseA, BaseB<string> {
  id: string;
}
export type MultilineUnion =
  | { type: 'A'; val: number }
  | { type: 'B'; val: string };
export const inlineFunction = function namedInline() { return true; };
`;

  const symbols = index.indexFile('repo', 'src/complex.ts', code);

  const names = symbols.map((s) => s.name);
  assert.ok(names.includes('defaultFn'), 'Missing defaultFn');
  assert.ok(names.includes('DefaultClass'), 'Missing DefaultClass');
  assert.ok(names.includes('idGenerator'), 'Missing idGenerator');
  assert.ok(names.includes('streamGenerator'), 'Missing streamGenerator');
  assert.ok(names.includes('arrowSimple'), 'Missing arrowSimple');
  assert.ok(names.includes('arrowNoParens'), 'Missing arrowNoParens');
  assert.ok(names.includes('arrowDestruct'), 'Missing arrowDestruct');
  assert.ok(names.includes('ExtendedInterface'), 'Missing ExtendedInterface');
  assert.ok(names.includes('MultilineUnion'), 'Missing MultilineUnion');
  assert.ok(names.includes('inlineFunction'), 'Missing inlineFunction');
});

// ─── 5. MULTI-LANGUAGE PARSING (PYTHON, GO, RUST) ──────────────────────────────
test('Stress tests Python declarations: async, decorators, inheritance, indentation', () => {
  const index = new ChangesetSymbolIndex();
  const pythonCode = `
class BaseService:
    pass

class VacationEngine(BaseService, IValidator):
    def __init__(self, config):
        self.config = config

    async def calculate_async(self, emp_id: str) -> float:
        return 10.5

@decorator
def top_level_func(a, b=None):
    return a
`;

  const symbols = index.indexFile('py-repo', 'calc/engine.py', pythonCode);
  const names = symbols.map((s) => s.name);

  assert.ok(names.includes('BaseService'));
  assert.ok(names.includes('VacationEngine'));
  assert.ok(names.includes('__init__'));
  assert.ok(names.includes('calculate_async'));
  assert.ok(names.includes('top_level_func'));
});

test('Stress tests Go declarations: receivers, structs, interfaces', () => {
  const index = new ChangesetSymbolIndex();
  const goCode = `
package engine

type Config struct {
    Max int
}

type Evaluator interface {
    Eval() bool
}

func (c *Config) GetMax() int {
    return c.Max
}

func (c Config) ValueReceiver() string {
    return "ok"
}

func StandaloneFunc(val string) error {
    return nil
}
`;

  const symbols = index.indexFile('go-repo', 'pkg/engine.go', goCode);
  const names = symbols.map((s) => s.name);

  assert.ok(names.includes('Config'));
  assert.ok(names.includes('Evaluator'));
  assert.ok(names.includes('GetMax'));
  assert.ok(names.includes('ValueReceiver'));
  assert.ok(names.includes('StandaloneFunc'));
});

test('Stress tests Rust declarations: async, unsafe, pub(crate), traits, structs', () => {
  const index = new ChangesetSymbolIndex();
  const rustCode = `
pub struct PublicStruct {
    pub id: u64,
}

pub(crate) struct CrateStruct;

pub enum Status {
    Ready,
    Done,
}

pub trait Worker {
    fn run(&self);
}

pub async fn async_fetch() -> Result<(), ()> {
    Ok(())
}

pub unsafe fn dangerous_exec() {
}

fn private_helper() -> i32 {
    42
}
`;

  const symbols = index.indexFile('rs-repo', 'src/worker.rs', rustCode);
  const names = symbols.map((s) => s.name);

  assert.ok(names.includes('PublicStruct'));
  assert.ok(names.includes('CrateStruct'));
  assert.ok(names.includes('Status'));
  assert.ok(names.includes('Worker'));
  assert.ok(names.includes('run'));
  assert.ok(names.includes('async_fetch'));
  assert.ok(names.includes('dangerous_exec'));
  assert.ok(names.includes('private_helper'));
});

// ─── 6. DIFF HUNK BOUNDARY EDGE CASES ─────────────────────────────────────────
test('Diff hunk correlation boundary edge cases: line 1, EOF, single-line additions/deletions', () => {
  const index = new ChangesetSymbolIndex();

  const code = [
    'export interface FirstLineIface { id: string; }', // Line 1
    '// Line 2 comment',
    'export function lineThreeFn() {}',                // Line 3
    '// Line 4 comment',
    'export class LineFiveCls {}',                     // Line 5
    '// Line 6 comment',
    'export function lastLineFn() {}',                 // Line 7
  ].join('\n');

  // Hunk 1: Single line addition at line 1
  // Hunk 2: Disjoint single line at line 5
  // Hunk 3: Hunk at EOF line 7
  const mockHunks: DiffHunkAction[] = [
    {
      id: 'hunk-line1',
      hunkIndex: 0,
      type: 'accept',
      startLineOriginal: 1,
      lineCountOriginal: 1,
      startLineModified: 1,
      lineCountModified: 1,
      patchHeader: '@@ -1,1 +1,1 @@',
      lines: ['+export interface FirstLineIface { id: string; }'],
    },
    {
      id: 'hunk-line5',
      hunkIndex: 1,
      type: 'accept',
      startLineOriginal: 5,
      lineCountOriginal: 2,
      startLineModified: 5,
      lineCountModified: 2,
      patchHeader: '@@ -5,2 +5,2 @@',
      lines: [
        ' export class LineFiveCls {}', // Context line, not addition
        ' // Line 6 comment',
      ],
    },
    {
      id: 'hunk-eof',
      hunkIndex: 2,
      type: 'accept',
      startLineOriginal: 7,
      lineCountOriginal: 0,
      startLineModified: 7,
      lineCountModified: 1,
      patchHeader: '@@ -7,0 +7,1 @@',
      lines: ['+export function lastLineFn() {}'],
    },
  ];

  const symbols = index.indexFile('repo', 'src/boundaries.ts', code, mockHunks);

  // Line 1: Hunk at boundary 1, added line
  const s1 = symbols.find((s) => s.name === 'FirstLineIface');
  assert.ok(s1);
  assert.equal(s1.lineNumber, 1);
  assert.equal(s1.isModifiedInChangeset, true);
  assert.equal(s1.changeType, 'added');
  assert.equal(s1.hunkIndex, 0);

  // Line 3: Not in any hunk
  const s3 = symbols.find((s) => s.name === 'lineThreeFn');
  assert.ok(s3);
  assert.equal(s3.lineNumber, 3);
  assert.equal(s3.isModifiedInChangeset, false);
  assert.equal(s3.changeType, 'context');

  // Line 5: Inside Hunk 2, but line in hunk does NOT start with '+', so changeType is 'modified'
  const s5 = symbols.find((s) => s.name === 'LineFiveCls');
  assert.ok(s5);
  assert.equal(s5.lineNumber, 5);
  assert.equal(s5.isModifiedInChangeset, true);
  assert.equal(s5.changeType, 'modified');
  assert.equal(s5.hunkIndex, 1);

  // Line 7: Hunk at EOF, added line
  const s7 = symbols.find((s) => s.name === 'lastLineFn');
  assert.ok(s7);
  assert.equal(s7.lineNumber, 7);
  assert.equal(s7.isModifiedInChangeset, true);
  assert.equal(s7.changeType, 'added');
  assert.equal(s7.hunkIndex, 2);
});

// ─── 7. WINDOWS PATH NORMALIZATION & MODEL URIS ───────────────────────────────
test('Handles Windows backslash paths, drive letters, and cross-repo duplicates', () => {
  const index = new ChangesetSymbolIndex();

  // Windows backslash path
  const winPath = 'src\\features\\changes\\utils\\testFile.ts';
  const symbolsWin = index.indexFile('my\\repo', winPath, 'export function winUtil() {}');

  assert.equal(symbolsWin.length, 1);
  assert.equal(symbolsWin[0].filePath, 'src/features/changes/utils/testFile.ts');
  assert.equal(symbolsWin[0].uriString, 'file:///my/repo/src/features/changes/utils/testFile.ts');

  // Duplicate file names across 2 different repositories
  index.indexFile('repoA', 'shared/config.ts', 'export const repoAConfig = 1;');
  index.indexFile('repoB', 'shared/config.ts', 'export const repoBConfig = 2;');

  const allSymbols = index.getAllSymbols();
  assert.ok(allSymbols.some((s) => s.repoName === 'repoA' && s.name === 'repoAConfig'));
  assert.ok(allSymbols.some((s) => s.repoName === 'repoB' && s.name === 'repoBConfig'));

  // Remove repoA file with Windows backslash path
  index.removeFile('repoA', 'shared\\config.ts');

  const afterRemoval = index.getAllSymbols();
  assert.ok(!afterRemoval.some((s) => s.repoName === 'repoA'));
  assert.ok(afterRemoval.some((s) => s.repoName === 'repoB'));
});

// ─── 8. CROSS-FILE EDITOR OPENER URI PARSING ──────────────────────────────────
test('registerCrossFileEditorOpener parses repo, relative path, and target line correctly', () => {
  let openedRepo = '';
  let openedPath = '';
  let openedLine: number | undefined;

  let registeredOpener: any = null;
  const mockMonaco = {
    editor: {
      registerEditorOpener(opener: any) {
        registeredOpener = opener;
        return { dispose: () => { registeredOpener = null; } };
      },
    },
  };

  const disposable = registerCrossFileEditorOpener((repo, file, line) => {
    openedRepo = repo;
    openedPath = file;
    openedLine = line;
  }, mockMonaco as any);

  assert.ok(registeredOpener);

  // Test standard file URI with line number
  const testUri = {
    scheme: 'file',
    path: '/NexusFlow/src/features/changes/file.ts',
  };
  const handled = registeredOpener.openCodeEditor(null, testUri, { lineNumber: 42 });

  assert.equal(handled, true);
  assert.equal(openedRepo, 'NexusFlow');
  assert.equal(openedPath, 'src/features/changes/file.ts');
  assert.equal(openedLine, 42);

  // Test startLineNumber variant
  registeredOpener.openCodeEditor(null, testUri, { startLineNumber: 88 });
  assert.equal(openedLine, 88);

  // Non-file scheme should be rejected
  const nonFileUri = { scheme: 'diff-original', path: '/NexusFlow/src/file.ts' };
  const rejected = registeredOpener.openCodeEditor(null, nonFileUri, { lineNumber: 1 });
  assert.equal(rejected, false);

  disposable.dispose();
  assert.equal(registeredOpener, null);
});

// ─── 9. VS CODE LAUNCHER URL SPECIFICATION ────────────────────────────────────
test('External launcher URL formats Windows paths and line numbers correctly with preferred editors', () => {
  // Test code-insiders
  const uriInsiders = computeEditorUri('C:\\Users\\dev\\NexusFlow', 'src\\index.ts', 15, 1, 'code-insiders');
  assert.equal(uriInsiders, 'vscode-insiders://file/C:/Users/dev/NexusFlow/src/index.ts:15:1');

  // Test vscode default
  const uriCode = computeEditorUri('C:\\Users\\dev\\NexusFlow', 'src\\index.ts', 15, 1, 'code');
  assert.equal(uriCode, 'vscode://file/C:/Users/dev/NexusFlow/src/index.ts:15:1');

  // Test cursor
  const uriCursor = computeEditorUri('C:\\Users\\dev\\NexusFlow', 'src\\index.ts', 15, 1, 'cursor');
  assert.equal(uriCursor, 'cursor://file/C:/Users/dev/NexusFlow/src/index.ts:15:1');

  // Test absolute filePath (should not duplicate repoPath)
  const uriAbs = computeEditorUri('C:\\Users\\dev\\NexusFlow', 'C:\\Users\\dev\\NexusFlow\\src\\index.ts', 20, 2, 'code-insiders');
  assert.equal(uriAbs, 'vscode-insiders://file/C:/Users/dev/NexusFlow/src/index.ts:20:2');

  // Test POSIX path (no double slash)
  const uriPosix = computeEditorUri('/home/dev/NexusFlow', 'src/index.ts', 1, 1, 'code-insiders');
  assert.equal(uriPosix, 'vscode-insiders://file/home/dev/NexusFlow/src/index.ts:1:1');

  // Relative repo path
  const uri2 = computeEditorUri('NexusFlow', 'gui/src/App.tsx', 100, 5, 'code-insiders');
  assert.equal(uri2, 'vscode-insiders://file/NexusFlow/gui/src/App.tsx:100:5');

  // Empty repo path
  const uri3 = computeEditorUri('', 'src/standalone.ts', 1, 1, 'code');
  assert.equal(uri3, 'vscode://file/src/standalone.ts:1:1');

  // Path with spaces
  const uri4 = computeEditorUri('C:\\My Projects\\Repo', 'sub folder\\file name.ts', 50, 1, 'code-insiders');
  assert.equal(uri4, 'vscode-insiders://file/C:/My%20Projects/Repo/sub%20folder/file%20name.ts:50:1');

  // Verify labels and commands
  assert.equal(getEditorLabel('code-insiders'), 'VS Code Insiders');
  assert.equal(getEditorLabel('code'), 'VS Code');
  assert.equal(getEditorLabel('cursor'), 'Cursor');
  assert.equal(getEditorCommand('code-insiders'), 'code-insiders');
  assert.equal(getEditorCommand('code'), 'code');
});

// ─── 10. REPOPATH PRESERVATION & CLEAR NOTIFICATION ───────────────────────────
test('ChangesetSymbolIndex preserves repoPath and notifies subscribers on clear', () => {
  const index = new ChangesetSymbolIndex();
  let updateCount = 0;
  index.subscribe(() => {
    updateCount++;
  });

  const repoPath = 'C:\\Users\\dev\\NexusFlow';
  const symbols = index.indexFile(
    'NexusFlow',
    'src/feature.ts',
    'export function computeTotal(a: number, b: number): number { return a + b; }',
    [],
    repoPath
  );

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0]!.name, 'computeTotal');
  assert.equal(symbols[0]!.repoPath, repoPath);
  assert.equal(updateCount, 1);

  // Clear should reset symbols and trigger notification
  index.clear();
  assert.equal(index.getAllSymbols().length, 0);
  assert.equal(updateCount, 2);
});
