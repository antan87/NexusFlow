import { describe, expect, it } from 'vitest';
import { changesFromResponse } from './changesResponse.js';

describe('changesFromResponse', () => {
  it('returns the list, including a genuinely empty one', () => {
    expect(changesFromResponse({ ok: true }, { changes: [{ repoName: 'app' }] })).toEqual([{ repoName: 'app' }]);
    expect(changesFromResponse({ ok: true }, { changes: [] })).toEqual([]);
  });

  it('refuses a failed reply and reports the server message', () => {
    expect(() => changesFromResponse({ ok: false, statusText: 'Internal Server Error' }, { error: 'Workspace configuration not found.' }))
      .toThrow('Failed to load changes: Workspace configuration not found.');
  });

  it('falls back to the status text, then to a generic message', () => {
    expect(() => changesFromResponse({ ok: false, statusText: 'Bad Gateway' }, {})).toThrow('Bad Gateway');
    expect(() => changesFromResponse({ ok: false }, null)).toThrow('unexpected response');
  });

  it('refuses an OK reply that carries no list, such as an "unchanged" token reply', () => {
    for (const body of [{ unchanged: true, token: 'x' }, {}, null, 'text', { changes: 'nope' }, { changes: null }]) {
      expect(() => changesFromResponse({ ok: true }, body), JSON.stringify(body)).toThrow(/Failed to load changes/);
    }
  });
});
