import { describe, expect, it } from 'vitest';
import { applySpellCheckerPolicy, spellCheckerEnabled } from './spellcheck.js';

function recordingSession() {
  const calls: string[] = [];
  return {
    calls,
    setSpellCheckerLanguages: (languages: string[]) => calls.push(`languages:${JSON.stringify(languages)}`),
    setSpellCheckerEnabled: (enabled: boolean) => calls.push(`enabled:${enabled}`),
  };
}

describe('desktop spell-checker policy', () => {
  it('keeps the macOS system spell checker, which downloads nothing', () => {
    expect(spellCheckerEnabled('darwin')).toBe(true);
    const session = recordingSession();
    expect(applySpellCheckerPolicy(session, 'darwin')).toBe(true);
    expect(session.calls).toEqual([]);
  });

  it.each(['linux', 'win32'])('empties the Hunspell dictionary list on %s so nothing is downloaded', (platform) => {
    expect(spellCheckerEnabled(platform)).toBe(false);
    const session = recordingSession();
    expect(applySpellCheckerPolicy(session, platform)).toBe(false);
    // Disabling alone still downloads; the empty list is what prevents it.
    expect(session.calls).toEqual(['languages:[]', 'enabled:false']);
  });
});
