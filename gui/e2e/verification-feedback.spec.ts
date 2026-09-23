import { test, expect } from './fixtures';

test.use({ workspacesData: [{
  id: 'demo', branchName: 'demo', description: 'Verification feedback', repos: ['C:/dev/demo'],
  assistants: [], workspacePath: 'C:/ws/demo', createdAt: '2026-06-01T00:00:00.000Z',
}] });

for (const status of ['no-tests', 'timeout', 'fail'] as const) {
  test(`explains ${status} and displays repository verification details`, async ({ page }) => {
    let report: any = null;
    await page.route('**/api/workspace/demo/plan', (route) => route.fulfill({ json: { content: '# Plan' } }));
    await page.route('**/api/workspace/demo/lifecycle', (route) => route.fulfill({ json: {
      lifecycle: { workspaceId: 'demo', flowType: 'feature', steps: [], fleet: [], updatedAt: '' }, report,
    } }));
    await page.route('**/api/workspace/demo/verify', (route) => {
      report = { overallStatus: status, canProgress: status === 'no-tests', durationMs: 123, repos: [{
        repoName: 'api', status, command: status === 'no-tests' ? 'none' : 'npm test',
        exitCode: status === 'no-tests' ? null : status === 'timeout' ? 124 : 0,
        stdout: status === 'no-tests' ? undefined : 'Test output for diagnosis',
        error: status === 'fail' ? 'Repository changed while tests were running. Review the changes and rerun verification.' : undefined,
      }] };
      return route.fulfill({ json: { report } });
    });
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByRole('button', { name: 'Visual Flow' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Run verification', exact: true }).click();
    const message = status === 'no-tests' ? 'No test command was found.'
      : status === 'timeout' ? 'Verification timed out.' : 'Verification failed.';
    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
    await expect(page.getByText(`api: ${status}`, { exact: true })).toBeVisible();
    if (status !== 'no-tests') await expect(page.getByText('Test output for diagnosis', { exact: true })).toBeVisible();
    if (status === 'fail') await expect(page.getByText(/Repository changed while tests were running/)).toBeVisible();
    await expect(page.getByText('Verification Gate FAILED with exit code non-zero. Check test errors.')).toHaveCount(0);
  });
}
