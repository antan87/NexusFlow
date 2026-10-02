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
  const parse = (text: string): FakeUri => ({
    scheme: text.slice(0, text.indexOf(':')),
    path: text.replace(/^[a-z-]+:\/\//, ''),
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
    },
  };
  return { api: api as unknown as Api, registry };
}

describe('changeset model disposal', () => {
  let store: StoreModule;

  beforeEach(async () => {
    // The store remembers the Monaco API it was given, so each test starts clean.
    vi.resetModules();
    store = await import('./changesetModelStore.js');
  });

  function openFile(api: Api, repo: string, file: string) {
    const modified = store.getOrCreateTextModel(store.getModifiedFileUri(repo, file, api), 'new', 'typescript', api);
    const original = store.getOrCreateTextModel(store.getOriginalFileUri(repo, file, api), 'old', 'typescript', api);
    return { modified: modified as unknown as FakeModel, original: original as unknown as FakeModel };
  }

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
