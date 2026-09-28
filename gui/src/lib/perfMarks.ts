/**
 * Named User Timing marks read by the performance harness in perf/.
 *
 * Marks are inert: they record a timestamp and never change behaviour. Names
 * are prefixed with `cs:` and `detail` identifies what became ready, so the
 * harness can time "click → ready" and spot responses applied for a
 * workspace the user already left.
 */
const MAX_MARKS = 500;
const once = new Set<string>();

export function perfMark(name: string, detail?: Record<string, unknown>): void {
  try {
    if (performance.getEntriesByType('mark').length >= MAX_MARKS) performance.clearMarks();
    performance.mark(name, detail ? { detail } : undefined);
  } catch {
    // User Timing is unavailable (old webview or test double); timing is optional.
  }
}

/** Records a mark only the first time `name` is seen in this page load. */
export function perfMarkOnce(name: string, detail?: Record<string, unknown>): void {
  if (once.has(name)) return;
  once.add(name);
  perfMark(name, detail);
}

/**
 * Keeps the first long tasks (main-thread work over 50 ms) of this page load
 * on `window.__csLongTasks` for the harness. Observing is passive and bounded.
 */
export function recordLongTasks(limit = 200): void {
  try {
    const log: Array<{ at: number; duration: number }> = [];
    (window as unknown as { __csLongTasks: typeof log }).__csLongTasks = log;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (log.length >= limit) { observer.disconnect(); return; }
        log.push({ at: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long Tasks API unavailable; the harness reports long tasks as missing.
  }
}
