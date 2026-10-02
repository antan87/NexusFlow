import { describe, expect, it } from 'vitest';
import { computeEditorUri } from './ExternalDiffLauncher.js';

describe('computeEditorUri', () => {
  it('builds a line and column link for a repository-relative file', () => {
    expect(computeEditorUri('/work/repo', 'src/a.ts', 3, 5)).toBe('vscode://file/work/repo/src/a.ts:3:5');
    expect(computeEditorUri('/work/repo/', 'src/a.ts')).toBe('vscode://file/work/repo/src/a.ts:1:1');
  });

  it('encodes characters that would otherwise end the path: spaces, # and ?', () => {
    expect(computeEditorUri('/work/repo', 'docs/a b.md')).toBe('vscode://file/work/repo/docs/a%20b.md:1:1');
    expect(computeEditorUri('/work/repo', 'notes/#1 plan?.md')).toBe('vscode://file/work/repo/notes/%231%20plan%3F.md:1:1');
    expect(computeEditorUri('/work/repo', '100%.txt')).toBe('vscode://file/work/repo/100%25.txt:1:1');
  });

  it('keeps the drive colon of a Windows path and normalizes its separators', () => {
    expect(computeEditorUri('C:\\Work\\repo', 'src\\x.ts', 2, 7)).toBe('vscode://file/C:/Work/repo/src/x.ts:2:7');
    expect(computeEditorUri('C:\\Work\\repo', 'C:\\Other\\y #1.ts')).toBe('vscode://file/C:/Other/y%20%231.ts:1:1');
  });

  it('uses an absolute file path as given, without the repository path', () => {
    expect(computeEditorUri('/work/repo', '/etc/hosts')).toBe('vscode://file/etc/hosts:1:1');
  });

  it('picks the URI scheme of the configured editor', () => {
    expect(computeEditorUri('/r', 'a.ts', 1, 1, 'cursor')).toMatch(/^cursor:\/\/file\//);
    expect(computeEditorUri('/r', 'a.ts', 1, 1, 'code-insiders')).toMatch(/^vscode-insiders:\/\/file\//);
    expect(computeEditorUri('/r', 'a.ts', 1, 1, 'windsurf')).toMatch(/^windsurf:\/\/file\//);
  });
});
