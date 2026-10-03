import { beforeEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('monaco-editor');
type StoreModule = typeof import('./changesetModelStore.js');

interface FakeUri { scheme: string; path: string; toString(): string }

class FakeModel {
  disposed = false;
  constructor(public value: string, public uri: FakeUri, private readonly registry: Map<string, FakeModel>) {}
  isDisposed(): boolean { return this.disposed; }
  getValue(): string { return this.value; }
  setValue(value: string): void { this.value = value; }
  dispose(): void {
    this.disposed = true;
    this.registry.delete(this.uri.toString());
  }
}

function fakeMonaco() {
  const registry = new Map<string, FakeModel>();
  const diffEditors: Array<{ getModel(): { original: FakeModel; modified: FakeModel } | null }> = [];
  const openers: Array<{ openCodeEditor(source: unknown, resource: FakeUri, position: unknown): boolean }> = [];
  const parse = (text: string): FakeUri => ({
    scheme: text.slice(0, text.indexOf(':')),
    path: text.replace(/^[a-z-]+:\/\/[^/]*/, ''),
    toString: () => text,
  });
  const api = {
    Uri: { parse },
    editor: {
      getModel: (uri: FakeUri) => registry.get(uri.toString()) ?? null,
      createModel: (value: string, _language: string, uri?: FakeUri) => {
        const model = new FakeModel(value, uri ?? parse(`inmemory://${registry.size}`), registry);
        registry.set(model.uri.toString(), model);
        return model;
      },
      getModels: () => [...registry.values()],
      getDiffEditors: () => diffEditors,
      getEditors: () => [],
      registerEditorOpener: (opener: { openCodeEditor(source: unknown, resource: FakeUri, position: unknown): boolean }) => {
        openers.push(opener);
        return { dispose: () => {} };
      },
    },
  };
  return { api: api as unknown as Api, registry, diffEditors, openers };
}

let store: StoreModule;

beforeEach(async () => {
  // The store remembers the Monaco API it was given, so each test starts clean.
  vi.resetModules();
  store = await import('./changesetModelStore.js');
});

/** Opens a file's two models the way the diff adapter does. */
function openFile(api: Api, repo: string, file: string, scope?: string) {
  const modified = store.getOrCreateTextModel(store.getModifiedFileUri(repo, file, api, scope), 'new', 'typescript', api);
  const original = store.getOrCreateTextModel(store.getOriginalFileUri(repo, file, api, scope), 'old', 'typescript', api);
  return { modified: modified as unknown as FakeModel, original: original as unknown as FakeModel };
}

describe('changeset model disposal', () => {
  it('disposes both models of one file and leaves other files alone', () => {
    const { api } = fakeMonaco();
    const target = openFile(api, 'app', 'src/a.ts');
    const other = openFile(api, 'app', 'src/b.ts');

    store.disposeChangesetModelsFor('app', 'src/a.ts', api);

    expect(target.modified.disposed).toBe(true);
    expect(target.original.disposed).toBe(true);
    expect(other.modified.disposed).toBe(false);
    expect(other.original.disposed).toBe(false);
  });

  it('is a no-op for a file that has no models, or whose models are already gone', () => {
    const { api } = fakeMonaco();
    openFile(api, 'app', 'src/a.ts');

    expect(() => store.disposeChangesetModelsFor('app', 'src/never-opened.ts', api)).not.toThrow();
    store.disposeChangesetModelsFor('app', 'src/a.ts', api);
    expect(() => store.disposeChangesetModelsFor('app', 'src/a.ts', api)).not.toThrow();
  });

  it('reaches the Monaco API it was given earlier when none is passed, as the bundled app does', () => {
    const { api, registry } = fakeMonaco();
    const file = openFile(api, 'app', 'src/a.ts');
    const unrelated = api.editor.createModel('scratch', 'plaintext') as unknown as FakeModel;

    store.disposeChangesetModelsFor('app', 'src/a.ts');
    expect(file.modified.disposed).toBe(true);

    const second = openFile(api, 'app', 'src/b.ts');
    store.disposeAllChangesetModels();
    expect(second.modified.disposed).toBe(true);
    expect(second.original.disposed).toBe(true);
    expect(unrelated.disposed).toBe(false);
    expect([...registry.values()]).toEqual([unrelated]);
  });

  it('does nothing, and does not throw, before any Monaco API is known', () => {
    expect(() => store.disposeChangesetModelsFor('app', 'src/a.ts')).not.toThrow();
    expect(() => store.disposeAllChangesetModels()).not.toThrow();
  });

  it('never disposes a model a live editor still holds, and still disposes the rest', () => {
    const { api, diffEditors } = fakeMonaco();
    const shown = openFile(api, 'app', 'src/a.ts');
    const hidden = openFile(api, 'app', 'src/b.ts');
    diffEditors.push({ getModel: () => ({ original: shown.original, modified: shown.modified }) });

    store.disposeChangesetModelsFor('app', 'src/a.ts', api);
    store.disposeChangesetModelsFor('app', 'src/b.ts', api);
    store.disposeAllChangesetModels(api);

    expect(shown.modified.disposed).toBe(false);
    expect(shown.original.disposed).toBe(false);
    expect(hidden.modified.disposed).toBe(true);
    expect(hidden.original.disposed).toBe(true);
  });

  it('disposes the models once the editor that held them is gone', () => {
    const { api, diffEditors } = fakeMonaco();
    const file = openFile(api, 'app', 'src/a.ts');
    diffEditors.push({ getModel: () => ({ original: file.original, modified: file.modified }) });
    store.disposeChangesetModelsFor('app', 'src/a.ts', api);
    expect(file.modified.disposed).toBe(false);

    diffEditors.length = 0;
    store.disposeChangesetModelsFor('app', 'src/a.ts', api);

    expect(file.modified.disposed).toBe(true);
    expect(file.original.disposed).toBe(true);
  });

  it('waits for the editors to release their models before disposing, as Monaco requires', () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeMonaco();
      const file = openFile(api, 'app', 'src/a.ts');

      store.disposeChangesetModelsAfterEditors([{ repoName: 'app', file: 'src/a.ts' }], api);
      expect(file.modified.disposed).toBe(false);
      expect(file.original.disposed).toBe(false);

      vi.runAllTimers();
      expect(file.modified.disposed).toBe(true);
      expect(file.original.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules nothing for an empty list', () => {
    vi.useFakeTimers();
    try {
      store.disposeChangesetModelsAfterEditors([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recreates a model for a file that was disposed and opened again', () => {
    const { api } = fakeMonaco();
    const first = openFile(api, 'app', 'src/a.ts');
    store.disposeChangesetModelsFor('app', 'src/a.ts', api);

    const again = openFile(api, 'app', 'src/a.ts');

    expect(again.modified).not.toBe(first.modified);
    expect(again.modified.disposed).toBe(false);
    expect(again.modified.getValue()).toBe('new');
  });
});

describe('workspace-scoped model URIs', () => {
  const uri = (repo: string, file: string, scope?: string) => store.getModifiedFileUri(repo, file, undefined, scope).toString();

  it('leaves the URI as it was when there is no scope', () => {
    expect(uri('app', 'src/a.ts')).toBe('file:///app/src/a.ts');
    expect(store.getOriginalFileUri('app', 'src/a.ts').toString()).toBe('diff-original:///app/src/a.ts');
  });

  it('gives the same repository and file a different URI in each workspace, with the path intact', () => {
    const one = uri('app', 'src/a.ts', '/ws/one/app');
    const two = uri('app', 'src/a.ts', '/ws/two/app');

    expect(one).not.toBe(two);
    expect(one).toMatch(/^file:\/\/[0-9a-f]{16}\/app\/src\/a\.ts$/);
    expect(two).toMatch(/^file:\/\/[0-9a-f]{16}\/app\/src\/a\.ts$/);
  });

  it('treats one worktree path as one scope however it is spelled', () => {
    const reference = uri('app', 'a.ts', 'C:/Work/ws/app');
    expect(uri('app', 'a.ts', 'C:\\Work\\ws\\app')).toBe(reference);
    expect(uri('app', 'a.ts', 'c:/work/ws/app/')).toBe(reference);
    expect(uri('app', 'a.ts', '/Work/ws/app')).not.toBe(uri('app', 'a.ts', '/work/ws/app'));
  });

  it('keeps each workspace its own model, so content and disposal do not leak across', () => {
    const { api } = fakeMonaco();
    const make = (scope: string, text: string) => {
      const model = store.getOrCreateTextModel(store.getModifiedFileUri('app', 'src/a.ts', api, scope), text, 'typescript', api) as unknown as FakeModel;
      return model;
    };
    const one = make('/ws/one/app', 'from workspace one');
    const two = make('/ws/two/app', 'from workspace two');

    expect(one).not.toBe(two);
    expect(one.getValue()).toBe('from workspace one');
    expect(two.getValue()).toBe('from workspace two');

    store.disposeChangesetModelsFor('app', 'src/a.ts', api, '/ws/one/app');
    expect(one.disposed).toBe(true);
    expect(two.disposed).toBe(false);
  });

  it('still reads the repository and file out of a scoped URI when Monaco opens it', () => {
    const { api, openers } = fakeMonaco();
    const opened: Array<[string, string, number | undefined]> = [];
    store.registerCrossFileEditorOpener((repo, file, line) => opened.push([repo, file, line]), api);

    const scoped = store.getModifiedFileUri('app', 'src/deep/a.ts', api, '/ws/one/app');
    expect(openers[0]!.openCodeEditor(null, scoped as unknown as FakeUri, { lineNumber: 7 })).toBe(true);

    expect(opened).toEqual([['app', 'src/deep/a.ts', 7]]);
  });

  it('disposes the scoped models after the editors when asked to, using each file\'s own scope', () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeMonaco();
      const one = openFile(api, 'app', 'src/a.ts', '/ws/one/app');
      const two = openFile(api, 'app', 'src/a.ts', '/ws/two/app');

      store.disposeChangesetModelsAfterEditors([{ repoName: 'app', file: 'src/a.ts', repoPath: '/ws/one/app' }], api);
      vi.runAllTimers();

      expect(one.modified.disposed).toBe(true);
      expect(two.modified.disposed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
