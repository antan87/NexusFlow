import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChangesetSymbolIndex,
  MonacoSymbolKind,
  registerLightweightNavigationProviders,
} from './changesetSymbolIndex.ts';
import {
  getModifiedFileUri,
  getOriginalFileUri,
  getCleanPath,
  getCleanRepo,
} from './changesetModelStore.ts';
import type { DiffHunkAction } from '../types.ts';

const SAMPLE_TS_FILE = `
export interface VacationAgreement {
  id: string;
  totalDays: number;
}

export type AgreementStatus = 'draft' | 'approved' | 'rejected';

export enum CalcMode {
  Standard = 1,
  Accrued = 2,
}

export class VacationDebtEngine {
  private baseDays = 25;
}

export function calculateVacationBalance(agreements: VacationAgreement[]): number {
  return agreements.reduce((acc, a) => acc + a.totalDays, 0);
}

export const computeDebtRatio = async (used: number, total: number): Promise<number> => {
  return used / total;
};
`;

const SAMPLE_PYTHON_FILE = `
class VacationService:
    def __init__(self):
        pass

def process_accrual(user_id, rate):
    return user_id * rate
`;

const SAMPLE_GO_FILE = `
package calc

type PolicyConfig struct {
    MaxDays int
}

func CalculateProratedDays(months int) int {
    return months * 2
}
`;

const SAMPLE_RUST_FILE = `
pub struct VacationRecord {
    pub days: u32,
}

pub enum RecordState {
    Active,
    Archived,
}

pub trait BalanceValidator {
    fn validate(&self) -> bool;
}

pub fn compute_allowance(record: &VacationRecord) -> u32 {
    record.days * 8
}
`;

const SAMPLE_CSHARP_FILE = `
namespace Hogia.Seniority;

public interface ISeniorityCalculator
{
    int Calculate(int months);
}

public sealed class SeniorityWorkflowTests
{
    private static int BuildDataset()
    {
        return 42;
    }
}

public enum PriorityBucket
{
    Low = 1,
    High = 2
}
`;

test('ChangesetSymbolIndex parses TypeScript declarations accurately', () => {
  const index = new ChangesetSymbolIndex();
  const symbols = index.indexFile('repo1', 'src/calc.ts', SAMPLE_TS_FILE);

  assert.equal(symbols.length, 6);

  const iface = symbols.find((s) => s.name === 'VacationAgreement');
  assert.ok(iface);
  assert.equal(iface.kindLabel, 'interface');
  assert.equal(iface.kind, MonacoSymbolKind.Interface);
  assert.equal(iface.lineNumber, 2);

  const typeAlias = symbols.find((s) => s.name === 'AgreementStatus');
  assert.ok(typeAlias);
  assert.equal(typeAlias.kindLabel, 'type');
  assert.equal(typeAlias.kind, MonacoSymbolKind.TypeParameter);
  assert.equal(typeAlias.lineNumber, 7);

  const enumDecl = symbols.find((s) => s.name === 'CalcMode');
  assert.ok(enumDecl);
  assert.equal(enumDecl.kindLabel, 'enum');
  assert.equal(enumDecl.kind, MonacoSymbolKind.Enum);
  assert.equal(enumDecl.lineNumber, 9);

  const classDecl = symbols.find((s) => s.name === 'VacationDebtEngine');
  assert.ok(classDecl);
  assert.equal(classDecl.kindLabel, 'class');
  assert.equal(classDecl.kind, MonacoSymbolKind.Class);
  assert.equal(classDecl.lineNumber, 14);

  const fnDecl = symbols.find((s) => s.name === 'calculateVacationBalance');
  assert.ok(fnDecl);
  assert.equal(fnDecl.kindLabel, 'function');
  assert.equal(fnDecl.kind, MonacoSymbolKind.Function);
  assert.equal(fnDecl.lineNumber, 18);

  const arrowFn = symbols.find((s) => s.name === 'computeDebtRatio');
  assert.ok(arrowFn);
  assert.equal(arrowFn.kindLabel, 'function');
  assert.equal(arrowFn.kind, MonacoSymbolKind.Function);
  assert.equal(arrowFn.lineNumber, 22);
});

test('ChangesetSymbolIndex parses Python symbols', () => {
  const index = new ChangesetSymbolIndex();
  const symbols = index.indexFile('backend', 'services/vacation.py', SAMPLE_PYTHON_FILE);

  assert.equal(symbols.length, 3);

  const cls = symbols.find((s) => s.name === 'VacationService');
  assert.ok(cls);
  assert.equal(cls.kindLabel, 'class');

  const fn = symbols.find((s) => s.name === 'process_accrual');
  assert.ok(fn);
  assert.equal(fn.kindLabel, 'function');

  const initMethod = symbols.find((s) => s.name === '__init__');
  assert.ok(initMethod);
  assert.equal(initMethod.kindLabel, 'function');
});

test('ChangesetSymbolIndex parses Go symbols', () => {
  const index = new ChangesetSymbolIndex();
  const symbols = index.indexFile('core', 'pkg/calc/engine.go', SAMPLE_GO_FILE);

  assert.equal(symbols.length, 2);

  const structType = symbols.find((s) => s.name === 'PolicyConfig');
  assert.ok(structType);
  assert.equal(structType.kindLabel, 'type');

  const fn = symbols.find((s) => s.name === 'CalculateProratedDays');
  assert.ok(fn);
  assert.equal(fn.kindLabel, 'function');
});

test('ChangesetSymbolIndex parses Rust symbols', () => {
  const index = new ChangesetSymbolIndex();
  const symbols = index.indexFile('native', 'src/engine.rs', SAMPLE_RUST_FILE);

  assert.equal(symbols.length, 5);

  const structSym = symbols.find((s) => s.name === 'VacationRecord');
  assert.ok(structSym);
  assert.equal(structSym.kindLabel, 'class');

  const enumSym = symbols.find((s) => s.name === 'RecordState');
  assert.ok(enumSym);
  assert.equal(enumSym.kindLabel, 'enum');

  const traitSym = symbols.find((s) => s.name === 'BalanceValidator');
  assert.ok(traitSym);
  assert.equal(traitSym.kindLabel, 'interface');

  const traitFn = symbols.find((s) => s.name === 'validate');
  assert.ok(traitFn);
  assert.equal(traitFn.kindLabel, 'function');

  const fnSym = symbols.find((s) => s.name === 'compute_allowance');
  assert.ok(fnSym);
  assert.equal(fnSym.kindLabel, 'function');
});

test('ChangesetSymbolIndex parses C# symbols', () => {
  const index = new ChangesetSymbolIndex();
  const symbols = index.indexFile('API_LasService', 'SeniorityWorkflowTests.cs', SAMPLE_CSHARP_FILE);

  const iface = symbols.find((s) => s.name === 'ISeniorityCalculator');
  assert.ok(iface);
  assert.equal(iface.kindLabel, 'interface');

  const cls = symbols.find((s) => s.name === 'SeniorityWorkflowTests');
  assert.ok(cls);
  assert.equal(cls.kindLabel, 'class');

  const method = symbols.find((s) => s.name === 'BuildDataset');
  assert.ok(method);
  assert.equal(method.kindLabel, 'function');

  const enumSym = symbols.find((s) => s.name === 'PriorityBucket');
  assert.ok(enumSym);
  assert.equal(enumSym.kindLabel, 'enum');
});


test('Correlates symbols with diff hunks accurately', () => {
  const index = new ChangesetSymbolIndex();

  // Hunk spanning lines 14-20 in modified content
  const mockHunks: DiffHunkAction[] = [
    {
      id: 'hunk-1',
      hunkIndex: 0,
      type: 'accept',
      startLineOriginal: 10,
      lineCountOriginal: 4,
      startLineModified: 14,
      lineCountModified: 7,
      patchHeader: '@@ -10,4 +14,7 @@',
      lines: [
        ' class VacationDebtEngine {',
        '+export function calculateVacationBalance(agreements: VacationAgreement[]): number {',
        '+  return agreements.reduce((acc, a) => acc + a.totalDays, 0);',
        '+}',
      ],
    },
  ];

  const symbols = index.indexFile('repo1', 'src/calc.ts', SAMPLE_TS_FILE, mockHunks);

  // VacationAgreement is line 2 -> not in hunk
  const iface = symbols.find((s) => s.name === 'VacationAgreement');
  assert.ok(iface);
  assert.equal(iface.isModifiedInChangeset, false);
  assert.equal(iface.changeType, 'context');

  // VacationDebtEngine is line 14 -> in hunk
  const cls = symbols.find((s) => s.name === 'VacationDebtEngine');
  assert.ok(cls);
  assert.equal(cls.isModifiedInChangeset, true);
  assert.equal(cls.hunkIndex, 0);
  assert.equal(cls.hunkId, 'hunk-1');

  // calculateVacationBalance is line 18 -> added in hunk
  const fn = symbols.find((s) => s.name === 'calculateVacationBalance');
  assert.ok(fn);
  assert.equal(fn.isModifiedInChangeset, true);
  assert.equal(fn.changeType, 'added');
  assert.equal(fn.hunkIndex, 0);

  // computeDebtRatio is line 22 -> outside hunk
  const arrowFn = symbols.find((s) => s.name === 'computeDebtRatio');
  assert.ok(arrowFn);
  assert.equal(arrowFn.isModifiedInChangeset, false);

  const modifiedOnly = index.getModifiedSymbols();
  assert.equal(modifiedOnly.length, 2);
});

test('Finds definitions across files and clears index', () => {
  const index = new ChangesetSymbolIndex();
  index.indexFile('repo1', 'src/file1.ts', 'export function sharedUtil() { return 1; }');
  index.indexFile('repo2', 'src/file2.ts', 'export function sharedUtil() { return 2; }');

  const matches = index.findDefinitions('sharedUtil');
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.repoName, 'repo1');
  assert.equal(matches[1]?.repoName, 'repo2');

  // Remove file1
  index.removeFile('repo1', 'src/file1.ts');
  assert.equal(index.findDefinitions('sharedUtil').length, 1);
  assert.equal(index.findDefinitions('sharedUtil')[0]?.repoName, 'repo2');

  // Clear all
  index.clear();
  assert.equal(index.getAllSymbols().length, 0);
  assert.equal(index.findDefinitions('sharedUtil').length, 0);
});

test('Changeset Model Store normalizes paths and formats URIs', () => {
  assert.equal(getCleanPath('\\src\\features\\calc.ts'), 'src/features/calc.ts');
  assert.equal(getCleanPath('/src/features/calc.ts'), 'src/features/calc.ts');
  assert.equal(getCleanRepo('/repo-a/'), 'repo-a');

  const modUri = getModifiedFileUri('NexusFlow', 'gui/src/calc.ts');
  assert.equal(modUri.scheme, 'file');
  assert.equal(modUri.path, '/NexusFlow/gui/src/calc.ts');

  const origUri = getOriginalFileUri('NexusFlow', 'gui/src/calc.ts');
  assert.equal(origUri.scheme, 'diff-original');
  assert.equal(origUri.path, '/NexusFlow/gui/src/calc.ts');
});

test('registerLightweightNavigationProviders safely returns disposable when monaco is unavailable', () => {
  const registration = registerLightweightNavigationProviders(undefined);
  assert.ok(registration);
  assert.equal(typeof registration.dispose, 'function');
  registration.dispose();
});
