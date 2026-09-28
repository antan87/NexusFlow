/**
 * Reads the `cs:` User Timing marks the GUI records (gui/src/lib/perfMarks.ts)
 * from a Playwright page. Mark times are relative to the page's timeOrigin.
 */
export async function readMarks(page) {
  return page.evaluate(() =>
    performance.getEntriesByType('mark')
      .filter((m) => m.name.startsWith('cs:'))
      .map((m) => ({ name: m.name, at: m.startTime, detail: m.detail ?? {} })),
  );
}

/** Page-relative "now", for timing an action against later marks. */
export function pageNow(page) {
  return page.evaluate(() => performance.now());
}

/**
 * Waits until a mark matching `name` (and every key in `match`) is recorded
 * at or after `since`, and returns it.
 */
export async function waitForMark(page, name, { match = {}, since = 0, timeout = 60_000 } = {}) {
  const handle = await page.waitForFunction(
    ({ name, match, since }) => {
      const found = performance.getEntriesByName(name, 'mark').find((m) =>
        m.startTime >= since && Object.entries(match).every(([k, v]) => m.detail?.[k] === v));
      return found ? { name: found.name, at: found.startTime, detail: found.detail ?? {} } : null;
    },
    { name, match, since },
    { timeout, polling: 50 },
  );
  return handle.jsonValue();
}
