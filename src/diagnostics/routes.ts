import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { getDataGuide } from '../core/data-guide.js';
import { collectDiagnostics, previewDiagnostics, reviewedDiagnostics, MAX_DIAGNOSTIC_BYTES } from '../core/diagnostics.js';

/** Mounted behind the main server's host/origin guards. No server-side file-write route. */
export function dataRoutes(resolveWorkspace: (id: string) => Promise<string>) {
  const routes = new Hono();
  for (const route of ['/data-guide', '/data-guide/*', '/diagnostics/*']) {
    routes.use(route, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  }
  routes.use('/diagnostics/*', bodyLimit({ maxSize: MAX_DIAGNOSTIC_BYTES + 8192,
    onError: c => c.json({ error: 'Diagnostic request exceeds the size limit.' }, 413) }));

  routes.get('/data-guide', c => c.json(getDataGuide()));
  routes.get('/data-guide/:workspaceId', async c => {
    try { return c.json(getDataGuide(await resolveWorkspace(c.req.param('workspaceId')))); }
    catch { return c.json({ error: 'Workspace unavailable.' }, 400); }
  });
  routes.post('/diagnostics/preview', async c => {
    try {
      const body = z.object({ workspaceId: z.string().min(1).max(255).optional() }).strict().parse(await c.req.json());
      const workspace = body.workspaceId ? await resolveWorkspace(body.workspaceId) : undefined;
      return c.json(await collectDiagnostics(workspace));
    } catch { return c.json({ error: 'Could not collect diagnostics. Check the workspace and try again.' }, 400); }
  });
  routes.post('/diagnostics/review', async c => {
    try {
      const body = z.object({ report: z.unknown(), omit: z.array(z.string()).max(3) }).strict().parse(await c.req.json());
      return c.json(previewDiagnostics(body.report, body.omit));
    } catch { return c.json({ error: 'Invalid diagnostic report or section selection.' }, 400); }
  });
  routes.post('/diagnostics/export', async c => {
    try {
      const body = z.object({ report: z.unknown(), digest: z.string() }).strict().parse(await c.req.json());
      const preview = reviewedDiagnostics(body.report, body.digest);
      c.header('Content-Disposition', 'attachment; filename="contextspace-diagnostics.json"');
      c.header('Content-Type', 'application/json; charset=utf-8');
      return c.body(preview.content);
    } catch { return c.json({ error: 'The report is invalid or changed. Review it again before exporting.' }, 400); }
  });
  return routes;
}
