import { afterEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

import { openInEditor } from './open-editor.js';

vi.mock('execa', () => ({ execa: vi.fn().mockResolvedValue({}) }));
vi.mock('./terminal-launch.js', () => ({ launchWorkspaceTerminal: vi.fn() }));

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...realPlatform, value: platform });
}

describe('openInEditor file launch', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    vi.mocked(execa).mockClear();
  });

  it('quotes the path for the Windows shell so spaces survive', async () => {
    stubPlatform('win32');

    await openInEditor('code', '/ws', 'a b.ts');

    expect(execa).toHaveBeenCalledWith(
      'code',
      [expect.stringMatching(/^".*a b\.ts"$/)],
      expect.objectContaining({ shell: true }),
    );
  });

  it('refuses a path that would break out of the Windows shell quoting', async () => {
    stubPlatform('win32');

    for (const filePath of ['x" & calc.exe & "', 'x"\nwhoami', 'x\0y']) {
      await expect(openInEditor('code', '/ws', filePath), JSON.stringify(filePath)).rejects.toThrow(/unsafe/);
    }
    expect(execa).not.toHaveBeenCalled();
  });

  it('refuses a path cmd.exe would rewrite by expanding %NAME%, but not a lone percent sign', async () => {
    stubPlatform('win32');

    for (const filePath of ['a%PATH%b.ts', '%COMSPEC%.ts', 'x%USERPROFILE%']) {
      await expect(openInEditor('code', '/ws', filePath), filePath).rejects.toThrow(/unsafe/);
    }
    expect(execa).not.toHaveBeenCalled();

    await openInEditor('code', '/ws', '100% done.ts');
    await openInEditor('code', '/ws', 'a% b %c.ts');
    expect(execa).toHaveBeenCalledTimes(2);
  });

  it('passes quotes through untouched where no shell is involved', async () => {
    stubPlatform('linux');

    await openInEditor('code', '/ws', 'say "hi".ts');

    expect(execa).toHaveBeenCalledWith(
      'code',
      [expect.stringContaining('say "hi".ts')],
      expect.objectContaining({ shell: false }),
    );
  });
});
