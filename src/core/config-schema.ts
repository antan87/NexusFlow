import path from 'node:path';
import { z } from 'zod';
import { isAssistantHarnessId } from '../harness/manifest.js';

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
    /**
     * Validated against the harness manifest rather than a literal union, so a
     * new harness is accepted the moment it is declared and a retired one is
     * rejected in one place. The error names the manifest instead of listing a
     * snapshot of it, which would go stale on the next addition.
     */
    defaultAssistant: z
      .string()
      .refine(isAssistantHarnessId, { message: 'must be a known assistant harness' })
      .nullable()
      .optional(),
    defaultEditor: z.string().nullable().optional(),
    scanDepth: z.number().int().min(1).max(10).optional(),
    storageProvider: z.string().min(1).optional(),
    latestDownloadUrl: z.string().url().nullable().or(z.literal('')).optional(),
  })
  .passthrough();
