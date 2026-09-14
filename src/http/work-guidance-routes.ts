import type { Hono, Context, Handler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { addWorkDocument, getWorkContext, readWorkDocument, updateWorkDocument, updateWorkGuidance } from '../core/work-guidance.js';
import { loadWorkspaceLifecycle, updateLifecyclePlan } from '../core/lifecycle.js';

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
