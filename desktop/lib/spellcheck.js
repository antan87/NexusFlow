/**
 * Spell-checker policy for the desktop app, kept free of Electron imports so
 * it can be tested without launching it.
 *
 * On Windows and Linux, Chromium spell-checks with Hunspell and downloads a
 * dictionary for every configured language from Google's CDN. The list comes
 * from the locale and the download starts as soon as the session exists, so it
 * cannot be turned off later (even in `whenReady`): the list has to be emptied
 * from Electron's `session-created` event. That download is an automatic
 * third-party request the data guide does not promise. macOS uses the system
 * spell checker, which downloads nothing, and keeps its default.
 */
export function spellCheckerEnabled(platform) {
  return platform === 'darwin';
}

/** Call from `app.on('session-created')`, before the session starts loading dictionaries. */
export function applySpellCheckerPolicy(session, platform) {
  if (spellCheckerEnabled(platform)) return true;
  session.setSpellCheckerLanguages([]);
  session.setSpellCheckerEnabled(false);
  return false;
}
