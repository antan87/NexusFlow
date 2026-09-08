import { expect, it } from 'vitest';
import { executeCli } from './quoting.js';

it('round-trips shell metacharacters as literal arguments on every platform', async () => {
    const args = ['commit', '-m', 'fix: %PATH% !TEMP! $(whoami) `id` " & calc & " \'quoted\' C:\\work\\\r\nline2\nline3'];
    const proc = executeCli(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args]);
    let stdout = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    const code = await new Promise((resolve, reject) => {
        proc.on('close', resolve);
        proc.on('error', reject);
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(args);
});
