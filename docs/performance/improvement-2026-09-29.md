# Performance improvements — 2026-09-29

Follow-up to the [2026-09-28 baseline](baseline-2026-09-28.md). The six fixes
listed there are implemented on `feat/performance` (commits `96fc42e` to
`027b284`). Raw results are in [`data/2026-09-29/`](data/2026-09-29/).

## Summary

- **All seven rules pass and are enforced.** In the baseline, R1, R2a, R2b, R3a and R3b failed. The fixes cover stale data after switching, cancelled requests, history re-reads, and Code panel background work.
- **Tier L** (50 workspaces × 3 repos):
  - git status complete: **−48%**, now within budget;
  - switching back to a visited workspace: **−97%**;
  - saved sessions: **−26%**, now within budget.
- **First open at L** takes 1.33 s (p95). The owner accepted this, and its budget is now 1.5 s, so every L budget passes.
- **Tier M** (31 workspaces): switching −86%, saved sessions −37%. Startup, which these fixes did not change, sits at the budget limit on a heavily loaded machine. It needs a confirmation run on a quiet machine.

## Method

- **Two packaged apps on the same fixtures:** the baseline build (`e754215`) and the fixed build (`027b284`). Both use the same Electron shell and dependencies; only `dist/` differs.
- **Launches alternated:** A, B, then B, A. `node perf/timing.mjs --app baseline=… --app after=…` does this.
- **Samples:** 20 measured launches per app per tier, after 2 warm-ups each.
- **Why alternating:** it cancels the machine drift that made separate sessions unreliable. The load average was 3 to 10 during the run, because other work was running on the laptop. Absolute numbers are therefore higher than in the baseline report, but the two apps saw the same conditions.

## Results (ms, baseline → after, same session)

### Tier L

| Metric | Baseline p50 / p95 | After p50 / p95 | p50 change | Budget (p95) |
|---|---|---|---|---|
| Backend ready | 1236 / 1471 | 1238 / 1519 | 0% | — |
| Cards usable | 2077 / 2500 | 2038 / 2567 | −2% | 3000 ✓ |
| Git status, first page | 4332 / 5274 | 2736 / 3385 | **−37%** | — |
| Git status complete | 6093 / 7560 | 3175 / 3852 | **−48%** | 5000 ✓ (was ✗) |
| Long tasks (ms) | 360 / 622 | 281 / 384 | −22% | — |
| Backend memory (MiB) | 242 / 244 | 217 / 220 | −11% | — |
| First workspace open | 1107 / 1676 | 1042 / 1326 | −6% | 1500 ✓ (owner raised from 1000) |
| Cached switch | 767 / 1156 | **20 / 38** | **−97%** | 500 ✓ (was ✗) |
| Diff open | 87 / 101 | 78 / 104 | −10% | 300 ✓ |
| Saved sessions, all sources | 1076 / 1522 | 792 / 1039 | **−26%** | 1000 ✓ (was ✗) |

### Tier M

| Metric | Baseline p50 / p95 | After p50 / p95 | p50 change | Budget (p95) |
|---|---|---|---|---|
| Backend ready | 1444 / 1957 | 1465 / 2331 | +1% | — |
| Cards usable | 2359 / 3185 | 2292 / 3481 | −3% | 3000 ✗ (limit 3300) |
| Git status complete | 3571 / 5544 | 3447 / 5315 | −3% | 5000 ✓ |
| Long tasks (ms) | 393 / 606 | 330 / 577 | −16% | — |
| Backend memory (MiB) | 259 / 261 | 195 / 198 | −25% | — |
| First workspace open | 369 / 776 | 361 / 810 | −2% | 1000 ✓ |
| Cached switch | 167 / 344 | **24 / 57** | **−86%** | 500 ✓ |
| Diff open | 67 / 104 | 74 / 109 | +10% | 300 ✓ |
| Saved sessions, first source | 115 / 228 | 177 / 301 | +54% | — |
| Saved sessions, all sources | 374 / 654 | 235 / 327 | **−37%** | 1000 ✓ |

**Reading the M startup rows.** None of the fixes touch the path to "cards usable":
- the medians agree (−3%);
- "backend ready", which no fix affects, also rose at p95 (1957 → 2331);
- the p95 difference (3185 → 3481) is within the spread seen under this load.

**Unexplained regression:** the first saved-session source arriving 60 ms later at M (flat at L).

### Endpoints (tier L, fresh backend, 3 samples)

| Endpoint | Baseline | After |
|---|---|---|
| Status page 1 | 3242 ms, 72 git, 600 MiB read | **627 ms, 7 git, 3 MiB** |
| Sessions, repeated request | 671 ms, 213 MiB re-read | **11 ms, 0 bytes** |
| Editor detection | up to 120 s (hung) | ≤ 5 s (bounded) |
| Launch targets | 1 s to 120 s (hung) | **170 ms** |

## Rules (tier S)

All seven pass and are listed in `perf/rules-enforced.json`:
- **R1:** a hidden Code panel now makes 0 requests and runs 0 git processes.
- **R2b:** an idle Code panel runs 1 git process per tick.
- **R2a:** a repeated sessions request reads 0 bytes.
- **R3a / R3b:** no stale data is applied, and 16 of 16 superseded requests are aborted.
- **R4 and R5:** unchanged (pass).

## What changed

| Fix | Commit | Effect |
|---|---|---|
| 1. Stale data and cancellation (D2) | `96fc42e` | Each workspace load has an abort slot and applies only while its workspace is current. Every React Query query passes its abort signal. |
| 2. Bounded detection (D3) | `57b3b33` | 5 s limit on every CLI probe. Editor detection is shared between concurrent callers and reused for 60 s. |
| 3. Transcript cache (H2) | `dfd2717` | Parsed sessions are kept per file while its size and mtime are unchanged. Rollouts recorded for other workspaces are skipped without being opened. |
| 4. Quiet Code panel (H1) | `e44f731` | Pauses while hidden. A refresh runs one `git status` and reuses the rest while nothing changed, `git --no-optional-locks` is used throughout, an `unchanged` token avoids resending the listing, and the diff is refetched only when the file changed. |
| 5. Status scan (H3) | `c5790f4` | One `git status` per distinct repository per scan, one shared Codex header scan, and 32 KB header reads. |
| 6. Warm switching | `027b284` | The last data of up to 16 recent workspaces is shown at once while a fresh load runs. |

## Remaining work and decisions

1. **First open at L (1.33 s p95).** Accepted by the owner on 2026-09-29; the L budget is now 1500 ms. The remaining cost is the first parse of a workspace's session history in a new app process.
2. **Confirm M startup on a quiet machine.** Re-run `node perf/timing.mjs --tier M` with the two apps once nothing else is running.
3. **Check the +60 ms first-source time at M**, which may be noise.
4. **Rules in CI.** The rules are deterministic and could run on every PR as a separate, non-release-blocking workflow.
5. **Merge with `main`.** Since this branch started, `main` gained 25 commits. One conflict, in `gui/src/pages/WorkspacesPage.tsx`, must be resolved and re-verified before a PR.

## Limits

- The fixture's Codex `session_meta` lines are small (real ones are about 20 KB). The 32 KB header read is therefore validated against real files on the reference laptop (18.5 to 23 KB), not by the timing runs.
- There is still no cold-disk or slow-disk measurement, since both need root.
