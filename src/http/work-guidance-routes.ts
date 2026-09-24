import { readPlanningNotes, savePlanningNotes } from '../core/planning-notes.js';
import type { Hono, Context, Handler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { addWorkDocument, getWorkContext, readWorkDocument, updateWorkDocument, updateWorkGuidance } from '../core/work-guidance.js';
import { loadWorkspaceLifecycle, updateLifecyclePlan } from '../core/lifecycle.js';
import { listRootDocuments, readRootDocument } from '../core/root-documents.js';

/** Mounted behind the server's existing local-origin boundary. */
export function registerWorkGuidanceRoutes(app: Hono, resolveWorkspace: (id: string) => Promise<string | null>) {
  const bounded = bodyLimit({ maxSize: 600_000 });
  const handle = (action: (workspacePath: string, c: Context) => Promise<object>): Handler => async (c) => {
    try {
      const root = await resolveWorkspace(z.string().min(1).parse(c.req.param('id')));
      if (!root) return c.json({ error: 'Workspace not found.' }, 404);
      return c.json(await action(root, c));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, error instanceof z.ZodError ? 400 : /changed.*session|Reload/.test(message) ? 409 : 400);
    }
  };
  app.get('/api/workspace/:id/planning-notes', handle((root) => readPlanningNotes(root)));
  app.get('/api/workspace/:id/documents', handle((root) => listRootDocuments(root)));
  app.get('/api/workspace/:id/documents/preview', handle(async (root, c) => {
    const { bytes: _bytes, ...document } = await readRootDocument(root, c.req.query('name') ?? '');
    return document;
  }));
  app.get('/api/workspace/:id/documents/file', async (c) => {
    try {
      const root = await resolveWorkspace(c.req.param('id'));
      if (!root) return c.json({ error: 'Workspace not found.' }, 404);
      const download = c.req.query('download') === '1';
      const document = await readRootDocument(root, c.req.query('name') ?? '', download);
      c.header('Content-Type', document.mime);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Cache-Control', 'no-store');
      c.header('Content-Security-Policy', "sandbox; default-src 'none'");
      c.header('Content-Disposition', `${download || document.kind === 'download' || document.kind === 'html' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(document.name).replace(/'/g, '%27')}`);
      return c.body(new Uint8Array(document.bytes));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unable to open document.' }, 400);
    }
  });
  app.put('/api/workspace/:id/planning-notes', bounded, handle(async (root, c) => {
    const input = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(500_000) }).parse(await c.req.json());
    return savePlanningNotes(root, input.revision, input.content);
  }));
  app.get('/api/workspace/:id/work', handle(async (root) => {
    await loadWorkspaceLifecycle(root);
    return getWorkContext(root);
  }));
  app.put('/api/workspace/:id/work', bounded, handle(async (root, c) => {
    await updateWorkGuidance(root, await c.req.json());
    return getWorkContext(root);
  }));
  app.post('/api/workspace/:id/work/documents', bounded, handle(async (root, c) => {
    const { revision, ...input } = await c.req.json();
    await addWorkDocument(root, z.number().int().nonnegative().parse(revision), input);
    return getWorkContext(root);
  }));
  app.patch('/api/workspace/:id/work/documents/:documentId', bounded, handle(async (root, c) => {
    const { revision, ...input } = await c.req.json();
    await updateWorkDocument(root, z.string().uuid().parse(c.req.param('documentId')), z.number().int().nonnegative().parse(revision), input);
    return getWorkContext(root);
  }));
  app.get('/api/workspace/:id/work/documents/:documentId', handle((root, c) => readWorkDocument(root, z.string().uuid().parse(c.req.param('documentId')))));
  app.put('/api/workspace/:id/lifecycle/plan', bounded, handle(async (root, c) => {
    const lifecycle = await updateLifecyclePlan(root, await c.req.json());
    return { lifecycle };
  }));
}
