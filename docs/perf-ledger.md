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

From `dc234bf` both sides of a pair begin measuring at the same settled point: every output warmed up and the main process quiet for a second (its worst turn 40 ms or less), or after 20 s whatever, said in the summary ("measuring began once settled, …"). On CI's Mac (run 39021244250) the first second after the outputs were ready had a 105 ms turn: the old start counted it. A stall of 277 ms still came 2.9 s into that run's measuring with no JavaScript behind it (handlers 6 ms at most, GC 2 ms): the Mac's virtual machine.

## The Performance check's phones and nodes as utility processes (Phase F, REL-7)

The check's 10 devices and 10 nodes moved from Electron run as Node to utility processes (`b9a7746`). Paired on CI's Mac with 10 of each, both sides passed twice: importing p90 25 and 29 ms (head) against 26 and 19 ms (base, `main`); all 10 devices connected and all 10 nodes online every time. One head run before them (39026396560) failed its importing figures (p90 86 ms, 3 of 28 over 100 ms) while the nodes copied 320 MB: the VM, as the four after it show.

## Quick wins (Phase G, PERF-5)

Each kept only if measured: more than 50% fewer commits, or more than 20% faster. Figures follow as each is tried.
