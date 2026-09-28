import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { collectDiagnostics, saveDiagnosticFile } from '../../../dist/core/diagnostics.js';

// Pause at the publication boundary after the real writer has flushed its file.
fs.link = async () => {
  process.send({ staged: true });
  await new Promise(() => {});
};
syncBuiltinESMExports();
await saveDiagnosticFile(process.argv[2], (await collectDiagnostics()).content);
