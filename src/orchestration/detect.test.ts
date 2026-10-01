import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  detectAllServices,
  detectOrchestrationTools,
  explicitPort,
  parseProcfile,
  shellInvocation,
  suggestProcfiles,
} from './detect.js';

let root: string;
const write = async (relative: string, content: string) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};
const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'fixture', scripts });

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'cs-detect-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Procfile declarations', () => {
  it('reads name: command lines with their line numbers and ignores everything else', () => {
    const entries = parseProcfile([
      '# local development',
      '',
      'web: PORT=3000 npm run dev',
      'worker:bundle exec sidekiq',
      'not a declaration',
      'bad name: echo no',
      'web: duplicate is ignored',
      '  api:   node server.js  ',
    ].join('\r\n'));
    expect(entries).toEqual([
      { name: 'web', command: 'PORT=3000 npm run dev', line: 3 },
      { name: 'worker', command: 'bundle exec sidekiq', line: 4 },
      { name: 'api', command: 'node server.js', line: 8 },
    ]);
  });

  it('only takes a port the command names explicitly', () => {
    expect(explicitPort('PORT=4000 node index.js')).toBe(4000);
    expect(explicitPort('vite --port 5173')).toBe(5173);
    expect(explicitPort('vite --port=5174')).toBe(5174);
    expect(explicitPort('rails s -p 3001')).toBe(3001);
    expect(explicitPort('node index.js')).toBeUndefined();
    expect(explicitPort('EXPORT=1 node x')).toBeUndefined();
  });

  it('runs a line through the platform shell', () => {
    expect(shellInvocation('npm run dev', 'linux')).toEqual({ command: '/bin/sh', args: ['-c', 'npm run dev'] });
    expect(shellInvocation('npm run dev', 'win32').args).toEqual(['/d', '/s', '/c', 'npm run dev']);
  });
});

describe('declared first, guesses labelled', () => {
  it('uses Procfile.dev over Procfile, replaces guesses for that repository, and flags other repositories as guessed', async () => {
    await write('shop/Procfile.dev', 'web: PORT=3000 npm run dev\nworker: node worker.js\n');
    await write('shop/Procfile', 'web: npm start\n');
    await write('shop/package.json', pkg({ dev: 'tsc --watch' }));
    await write('tools/package.json', pkg({ dev: 'tsc --watch' }));

    const services = await detectAllServices(root);
    const byName = Object.fromEntries(services.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(['shop/web', 'shop/worker', 'tools']);
    expect(byName['shop/web']).toMatchObject({
      declared: true, source: 'procfile', port: 3000, cwd: path.join(root, 'shop'),
      declaredIn: { file: 'Procfile.dev', line: 1 }, display: 'PORT=3000 npm run dev',
    });
    expect(byName['shop/web']!.args.at(-1)).toBe('PORT=3000 npm run dev');
    expect(byName.tools).toMatchObject({ declared: false, source: 'package.json', command: 'npm', args: ['run', 'dev'] });
  });

  it('no longer offers a Procfile as a honcho orchestrator', async () => {
    await write('shop/Procfile', 'web: npm start\n');
    expect((await detectOrchestrationTools(root)).map((t) => t.tool)).not.toContain('procfile');
  });
});

describe('Makefile targets', () => {
  it('runs the target that exists and does not mistake restart: or := for a target', async () => {
    await write('a/Makefile', 'run:\n\tgo run .\n');
    await write('b/Makefile', 'restart:\n\techo restart\nFLAGS := -dev:\n');
    await write('c/Makefile', 'start:\n\t./serve\ndev:\n\t./serve --dev\n');

    const tools = await detectOrchestrationTools(root);
    const make = Object.fromEntries(tools.filter((t) => t.tool === 'makefile').map((t) => [path.basename(path.dirname(t.configPath)), t]));
    expect(Object.keys(make).sort()).toEqual(['a', 'c']);
    expect(make.a!.run.args.at(-1)).toBe('run');
    expect(make.c!.run.args.at(-1)).toBe('dev');

    const services = await detectAllServices(root);
    expect(services.find((s) => s.name === 'a')).toMatchObject({ command: 'make', args: ['run'], declared: false });
    expect(services.find((s) => s.name === 'b')).toBeUndefined();
  });
});

describe('Procfile.dev suggestions', () => {
  it('groups guesses by repository root and runs nested ones from their folder', async () => {
    const suggestions = suggestProcfiles([
      { name: 'tools', cwd: '/w/tools', command: 'npm', args: ['run', 'dev'], source: 'package.json', declared: false },
      { name: 'api/server', cwd: '/w/api/server', command: 'dotnet', args: ['run'], source: 'dotnet', declared: false },
      { name: 'api/web', cwd: '/w/api/web', command: 'npm', args: ['run', 'dev'], source: 'package.json', declared: false },
    ]);
    expect(suggestions).toEqual([
      { file: path.join('/w/tools', 'Procfile.dev'), content: 'web: npm run dev\n' },
      { file: path.join('/w/api', 'Procfile.dev'), content: 'server: cd server && dotnet run\nweb: cd web && npm run dev\n' },
    ]);
  });
});
