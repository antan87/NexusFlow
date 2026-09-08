import { copyFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const icons = new URL('media/codicons/', root);
await mkdir(icons, { recursive: true });
for (const name of ['codicon.css', 'codicon.ttf']) {
  await copyFile(new URL(`node_modules/@vscode/codicons/dist/${name}`, root), new URL(name, icons));
}
await copyFile(new URL('../LICENSE', root), new URL('LICENSE', root));
