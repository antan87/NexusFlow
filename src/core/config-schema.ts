import path from 'node:path';
import { z } from 'zod';

const absDir = z
  .string()
  .trim()
  .min(1)
  .refine((v) => path.isAbsolute(v), { message: 'must be an absolute path' })
  .refine((v) => {
    const resolved = path.resolve(v);
    const parsed = path.parse(resolved);
    return resolved !== parsed.root;
  }, { message: 'must not be a filesystem root' });

export const configPatchSchema = z
  .object({
    devDir: absDir.optional(),
    workspacesDir: absDir.optional(),
    defaultAssistant: z.enum(['claude', 'antigravity', 'codex', 'copilot', 'cursor']).nullable().optional(),
    defaultEditor: z.string().nullable().optional(),
    scanDepth: z.number().int().min(1).max(10).optional(),
    storageProvider: z.string().min(1).optional(),
    latestDownloadUrl: z.string().url().nullable().or(z.literal('')).optional(),
  })
  .passthrough();
