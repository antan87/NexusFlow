import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import { detectEditors } from './detect-editors.js';

vi.mock('execa');

describe('detectEditors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return detected = true for editors whose commands exit with 0', async () => {
    vi.mocked(execa).mockImplementation((command: any, args?: any, options?: any): any => {
      if (command === 'code' || command === 'cursor') {
        return Promise.resolve({ exitCode: 0 } as any);
      }
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectEditors();

    expect(result).toEqual([
      { name: 'VS Code', command: 'code', detected: true },
      { name: 'VS Code Insiders', command: 'code-insiders', detected: false },
      { name: 'Cursor', command: 'cursor', detected: true },
      { name: 'Antigravity', command: 'antigravity', detected: false },
    ]);

    const isWin = process.platform === 'win32';
    expect(execa).toHaveBeenCalledWith('code', ['--version'], { reject: false, shell: isWin });
    expect(execa).toHaveBeenCalledWith('code-insiders', ['--version'], { reject: false, shell: isWin });
    expect(execa).toHaveBeenCalledWith('cursor', ['--version'], { reject: false, shell: isWin });
    expect(execa).toHaveBeenCalledWith('antigravity', ['--version'], { reject: false, shell: isWin });
  });

  it('should return detected = false for all editors if execa throws an error', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('Spawn error'));

    const result = await detectEditors();

    expect(result).toEqual([
      { name: 'VS Code', command: 'code', detected: false },
      { name: 'VS Code Insiders', command: 'code-insiders', detected: false },
      { name: 'Cursor', command: 'cursor', detected: false },
      { name: 'Antigravity', command: 'antigravity', detected: false },
    ]);
  });
});
