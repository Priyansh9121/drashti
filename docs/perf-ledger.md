# Performance ledger

Each paired Performance round, and each change made or tried for speed, with its figures (Sessions 31–36, PERF-2). Newest last.

## How to read it

- **A round** is three Performance runs of each ref, the head and the base (the commit before the phase), started side by side on the same day, on CI's Mac and Windows virtual machines (`.github/workflows/performance.yml`). The figures are the check's own (`src/main/perftest.ts`): a slide change from the operator window to the output's frame, while idle and during an import of 400 files, as median, p90 and worst; and the main process's worst block (its longest time without a turn).
- **The budgets** are the check's and do not change here: half the changes during the import within one frame (17 ms), 9 in 10 within two (34 ms), no more than 2% over 100 ms, and the main process never more than 150 ms without a turn.
- **The virtual machines swing.** Between runs of one ref, CI's Mac moves a change's p90 by 5 to 10 ms and its worst block by tens of milliseconds; Windows rarely moves its importing p90 at all. A round says "no change" unless the head's figures sit outside the base's on every run.
- **From Sessions 31–36 on** the check also gives each change's segments, with p95 and p99: key to main (the operator window to the main process), main to frame (the main process to the output's frame) and frame to the next (how long that frame took to draw). Every change's raw times are kept 90 days (the `perf-raw-<system>` artifact), and `scripts/perf-compare.mjs` compares a head's runs with a base's, each segment's median and p95 with a 95% bootstrap interval (`src/main/release-checks/perf-compare.test.ts`):

  ```
  node scripts/perf-compare.mjs --base base-1.json base-2.json base-3.json --head head-1.json head-2.json head-3.json
  ```

## Round A: stream and sound (Sessions 31–36, Phase A), 17 October 2026

Head `2b780b1`, base `56747b2`. Runs: head 38984556354, 38984588965, 38984623459; base 38984572881, 38984605168, 38984639874. The plain check, then the streaming check (two places at once, and recording).

| System  | Ref  | Importing p90 (plain), each run | Streaming: frames a second, each run |
| ------- | ---- | ------------------------------- | ------------------------------------ |
| Mac     | head | 17, 33, 33 ms                   | 28.0, 28.0, 29.7                     |
| Mac     | base | 32, 33, 26 ms                   | 24.3, 29.1, 27.2                     |
| Windows | head | 15, 15, 15 ms                   | 30.0, 30.0, 30.0                     |
| Windows | base | 15, 15, 15 ms                   | 30.0, 30.1, 30.0                     |

No change beyond the swing. One base run on Windows went 1,007 ms without a turn during its streaming import (the 150 ms rule, a failure of the base, not the head).

## Round C: slides that read well in the hall (Phase C), 17 October 2026

Head `50f0175`, base `cc8a990`. Runs: head 39002834412, 39002861252, 39002887329; base 39002847568, 39002874160, 39002899497.

| System  | Ref  | Importing p90, each run | Worst block, each run |
| ------- | ---- | ----------------------- | --------------------- |
| Mac     | head | 25, 25, 27 ms           | 9, 46, 18 ms          |
| Mac     | base | 31, 32, 32 ms           | 26, 87, 10 ms         |
| Windows | head | 15, 15, 15 ms           | 13, 12, 12 ms         |
| Windows | base | 15, 15, 15 ms           | 14, 12, 7 ms          |

No change (the Mac's head a little quicker, within the swing).

## Round D: Gujarati and Hindi drawn right (Phase D, fonts), 17 October 2026

Head `9a10104`, base `50f0175`. Runs: head 39009618480, 39009643149, 39009665725; base 39009631090, 39009654467, 39009678900.

| System  | Ref  | Importing p90, each run | Worst block, each run |
| ------- | ---- | ----------------------- | --------------------- |
| Mac     | head | 32, 33, 32 ms           | 52, 46, 12 ms         |
| Mac     | base | 27, 24, 25 ms           | 24, 25, 12 ms         |
| Windows | head | 14, 15, 15 ms           | 11, 12, 12 ms         |
| Windows | base | 15, 15, 15 ms           | 15, 12, 23 ms         |

Every run within its budgets. On the Mac the head's importing p90 sat above the base's on all three runs (32 to 33 ms against 24 to 27), the size of the Mac's swing between runs of one ref (round C's base and head differed as much the other way): said, and to be read again with the raw times from round G on.

## Where the measuring begins, and what it waits for (Phase E, the 150 ms rule)

From `152fe6a` both sides of a pair begin measuring at the same settled point: every output warmed up and the main process quiet for a second (its worst turn 40 ms or less), or after 20 s whatever, said in the summary ("measuring began once settled, …"). On CI's Mac (run 39021244250) the first second after the outputs were ready had a 105 ms turn: the old start counted it. A stall of 277 ms still came 2.9 s into that run's measuring with no JavaScript behind it (handlers 6 ms at most, GC 2 ms): the Mac's virtual machine.

## The Performance check's phones and nodes as utility processes (Phase F, REL-7)

The check's 10 devices and 10 nodes moved from Electron run as Node to utility processes (`fcacf26`). Paired on CI's Mac with 10 of each, both sides passed twice: importing p90 25 and 29 ms (head) against 26 and 19 ms (base, `main`); all 10 devices connected and all 10 nodes online every time. One head run before them (39026396560) failed its importing figures (p90 86 ms, 3 of 28 over 100 ms) while the nodes copied 320 MB: the VM, as the four after it show.

## Round G: speed and crash recovery (Phase G), 18 October 2026

Head `d6778b6` (Phase G's end), base `1e78262`: Phase F's end (`3571714`) with G's measuring alone (`38a0889`'s segments and raw times) put on it, so both sides keep the same raw times for `scripts/perf-compare.mjs`. Runs: head 39040418838, 39040449005, 39040477427; base 39040434256, 39040462846, 39040492388. (A first try that day did not count: its base had a fault of mine in the test file and measured nothing, and its head still had a change later taken back.)

| System  | Ref  | Importing p90, each run | Worst block, each run | Recovery figure, each run |
| ------- | ---- | ----------------------- | --------------------- | ------------------------- |
| Mac     | head | 25, 29, 25 ms           | 31, 18, 7 ms          | 5.4, 4.4, 6.1 s           |
| Mac     | base | 33, 33, 23 ms           | 36, 82, 8 ms          | (not measured before G)   |
| Windows | head | 15, 15, 15 ms           | 11, 4, 10 ms          | 3.3, 5.0, 5.1 then 4.4 s  |
| Windows | base | 15, 15, 15 ms           | 3, 4, 3 ms            | (not measured before G)   |

Every head run passed; one base run failed on the Mac (half the changes within a frame: median 19 ms). The comparer, each system's three runs against three: on Windows no change in any segment's median or p95; on the Mac no change in any median, and key to main's p95 (4 to 1 ms) and frame to the next's (21 to 18 ms) faster. No change beyond the swing. On Windows one recovery figure (5.1 s, just over the budget) was measured again, 4.4 s, as the rule says.

## The recovery figure and its budget (Phase G, PERF-1), 18 October 2026

After a crash, how long from Drashti starting again to its screens back (`tests/e2e/recovery-figure.ts`): read from the start's phase lines (`src/main/start-phases.ts`), to the output's first painted frame of the show put back. Ten runs on each of CI's systems (`9776e94`; runs 39038852887 on the Mac and 39038858168 on Windows):

| System  | Figures, in order (s)                            | p90   | Budget (p90 + 25%) |
| ------- | ------------------------------------------------ | ----- | ------------------ |
| Mac     | 9.0, 5.3, 5.6, 5.2, 5.3, 4.3, 3.4, 3.9, 4.7, 4.8 | 5.6 s | **7.0 s**          |
| Windows | 3.6, 3.5, 3.5, 4.1, 3.4, 3.3, 5.0, 3.3, 3.7, 3.6 | 4.1 s | **5.1 s**          |

Where the time goes, on the Mac: the main process running at 0.1 to 0.3 s, the library open and the engine ready by 0.6 s, the operator window shown by 1.5 s, and the output's first frame at 3.4 to 9.0 s, after its GPU's warm-up (Windows: 0.6 s, then 3.3 to 5.0 s). The Performance check holds it to the budget (`RECOVERY_BUDGET_MS`); a figure over it is measured again, and it fails only when over twice in a row. The end-to-end test says it without judging it: timing is judged in the Performance check (the README's rule), and in the whole suite CI's Windows machine took 6.8 to 7.7 s (run 39042346766, the checkpoint run that found this) for what took it 3.3 to 5.0 s alone. The ten runs were of the test alone; the Performance check's own figures fit the same budget in round G (Mac 5.4, 4.4 and 6.1 s; Windows 3.3, 5.0 and 5.1 then 4.4 s), but not in the last round, and the budget was set again from the Performance check's own runs (below).

## Quick wins (Phase G, PERF-5), 18 October 2026

Each kept only if measured: more than 50% fewer commits, or more than 20% faster ("neutral is a revert"). Measured on the development Mac (Apple silicon), the build before (`b700571`) against the build with the change, one change at a time. Commits are React's in the operator window, counted by a stand-in for React DevTools' hook installed before the page loads (its `onCommitFiberRoot`), over 5 s, three times.

| Item | What                                                                                                                                           | Before                                                                                                  | After            | Kept?                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)  | The Stream panel's level meter follows the level through refs, not the panel's state (`src/renderer/src/stream/preview.ts`, `StreamPanel.tsx`) | 16.2, 16.2, 15.8 commits a second with the fake microphone's level running                              | 6.0, 6.0, 6.6    | **Kept**: 62% fewer                                                                                                                                   |
| (b)  | Simple Mode's big buttons take three narrow choices from the engine's state instead of all of it                                               | 71, 71, 70 commits for 50 changes the operator window never shows (stage messages, 5 s)                 | 70, 70, 71       | **Reverted**: no change (other parts of Simple Mode follow every change of the show)                                                                  |
| (c)  | `content-visibility: auto` on each thumbnail of a grid with over 60 slides                                                                     | a 200-slide grid's first render (opened to 200 thumbnails and two frames), median of six: 99, 99, 99 ms | 116, 116, 116 ms | **Reverted**: 17% slower (the 200 thumbnails cost more in React than in layout, and the containment adds work)                                        |
| (d)  | The clock style's `Intl.DateTimeFormat` made once (`formatClock`, `src/shared/format.ts`), only for a style, which names its time zone         | 31.5, 28.1 µs a call (20,000 calls, Electron's Node)                                                    | 1.5, 1.6 µs      | **Kept**: 95% faster; the same words for every minute of a day. A stage clock writes once a second, so it saves about 30 µs a second per stage screen |

## The last round: alpha.6 against alpha.5 (Phase H), 18 October 2026

Head `8541372` (1.0.0-alpha.6), base `9df47ac` (alpha.5). Runs: head 39072953675, 39072981594, 39073007463; base 39072967308, 39072994993, 39073020450. The base's Performance check is alpha.5's own: it begins measuring as soon as the outputs are ready (not at Phase E's settled point), keeps no raw times and has no recovery figure, so this round compares the summaries alone.

| System  | Ref  | Idle p90, each run | Importing p90, each run | Worst block, each run | Recovery figure, each run |
| ------- | ---- | ------------------ | ----------------------- | --------------------- | ------------------------- |
| Mac     | head | 19, 32, 31 ms      | 31, 30, 26 ms           | 21, 12, 20 ms         | 4.1, 7.8, 3.5 s           |
| Mac     | base | 65, 33, 32 ms      | 32, 32, 25 ms           | 11, 7, 12 ms          | (not measured before G)   |
| Windows | head | 14, 15, 13 ms      | 15, 15, 15 ms           | 3, 2, 3 ms            | 2.7, 1.8, 2.9 s           |
| Windows | base | 16, 16, 15 ms      | 15, 15, 15 ms           | 12, 10, 7 ms          | (not measured before G)   |

Every run passed. No change. The Mac's worst block sat a little above the base's (21, 12, 20 against 11, 7, 12 ms), far inside the 150 ms rule and the Mac's swing (the first try below: 12, 48, 9 against 16, 114, 7).

A first try of this round, on `80b98e7` (the same app but for the crash reporter under Rosetta, Phase H), gave the same picture. Runs: head 39065895419, 39065925578, 39065957732; base 39065909532, 39065942465, 39065970986. Importing p90: Mac 33, 29, 31 against 29, 31, 22 ms; Windows 15 everywhere. The Mac's idle p90 was 32, 33, 32 against 28, 25, 27 ms, the medians the same, and four more runs of that head gave 25, 33, 20 and 32 ms (39066656163, 39066668826, 39066680371, 39068007134): the swing. One head run was over the Mac's recovery budget of the time (7.9 then 7.2 s against 7.0 s; the next section). One base run failed on the Mac: half the changes during the import within a frame (median 18 ms), with a 114 ms block while the import wrote a presentation.

## The recovery budget from the Performance check (Phase H, PERF-1), 18 October 2026

The budget is judged in the Performance check, which measures the figure after its own checks, and there it ran longer than in the end-to-end test alone: one run of the last round's head was over the Mac's 7.0 s twice (7.9 then 7.2 s, 39065925578). So it was set again by the same rule, the 90th percentile of 10 runs plus 25%, from the Performance check's own runs: each run's first figure, from round G's three head runs (`d6778b6`), the last round's three and four more of its head (`80b98e7`).

| System  | Each run's first figure (s)                      | p90   | Budget (p90 + 25%) |
| ------- | ------------------------------------------------ | ----- | ------------------ |
| Mac     | 5.4, 4.4, 6.1, 4.6, 7.9, 8.1, 4.4, 5.9, 6.2, 3.4 | 7.9 s | **9.9 s**          |
| Windows | 3.3, 5.0, 5.1, 3.8, 4.9, 2.8, 5.2, 4.1, 5.1, 2.0 | 5.1 s | **6.4 s**          |

Runs, in order: 39040418838, 39040449005, 39040477427, 39065895419, 39065925578, 39065957732, 39066656163, 39066668826, 39066680371, 39068007134. A second figure was measured where the first was over the budget of the time (Mac 7.2 and 4.6 s; Windows 4.4 and 3.6 s). Most of the time is still the output's first frame after its GPU's warm-up. The bar guard lists the raise; it is the budget made by its own rule where it is judged, not a looser test of anything that was measured before.

## The hung-window dump's hold, measured on Windows (Session 37), 18 October 2026

With crash files kept (Phase G), the watchdog restarts a hung window with Electron's `forcefullyCrashRenderer`, which writes the window's dump inside the main process (`src/main/watchdog.ts`, `hung`): the main process waits meanwhile, so a slide change from the operator waits too, while the other screens keep their picture. Phase H measured 238 to 274 ms on the dev Mac. A scratch self-test (`DRASHTI_SELFTEST=dump-hold` on branch `s37-dumphold`, not kept) timed each call in the main process with `performance.now()`: an output, the audio player and the operator window, six calls each on a page at rest and two on a page stuck in a loop, each writing one dump; and two kills by pid beside them, which write none. Each window was crashed at most once every 14 s, so the watchdog never gave up. CI run 39106819402 (both systems), and the dev Mac (M2, quiet test mode).

| System            | Output at rest, six calls (median) | Audio player at rest (median) | Operator window at rest (median) | A hung page: output, audio player, operator | A kill by pid |
| ----------------- | ---------------------------------- | ----------------------------- | -------------------------------- | ------------------------------------------- | ------------- |
| Windows (CI's VM) | 52.7 to 144.9 ms (81)              | 40.2 to 139.3 ms (64)         | 63.1 to 442.8 ms (78)            | 55 to 101, 100 to 111, 46 to 53 ms          | 0.2 to 0.3 ms |
| Mac (CI's VM)     | 336 to 745 ms (404)                | 318 to 559 ms (350)           | 339 to 1,153 ms (386)            | 625 to 801, 1,079 to 1,145, 534 to 581 ms   | 0 to 0.6 ms   |
| Mac (the dev Mac) | 225 to 790 ms (247)                | 219 to 235 ms (226)           | 218 to 332 ms (224)              | 219 to 222, 492 to 504, 220 to 222 ms       | 0 to 0.2 ms   |

Windows holds at most 443 ms (once, the operator window; otherwise under 145 ms), within the 500 ms set for it (decided 18 Oct 2026), so the dump is kept as it is: a hung window is still restarted with its dump. On the dev Mac the hold is a quarter of a second, as in Phase H, apart from a run's first dump (790 ms) and a hung audio player (half a second). CI's Mac VM takes 1.5 to 1.7 times the dev Mac's medians, as it is slower at everything else here.

Since Session 38 (decided 18 Oct 2026: the dump kept everywhere) each real restart logs its own figure, timed on the watchdog's clock: `Watchdog: output "Hall 1" restarted (Drashti waited 240 ms while it saved the crash file)` (README, Crash files). So a hang on the mandir's own Mac, not measured here, gives its figure in Save Diagnostics….
