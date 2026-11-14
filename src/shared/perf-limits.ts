/*
 * The Performance check's time on a heavy run (a scenario, or the workflow's modest hardware: tests/perf/
 * performance.spec.ts), shared by the spec that stops Drashti and the animations scenario that presses its cases
 * (main/perf-animations.ts). Session 58 (h-perfcap, the sweep's #17): on a slow two-core runner while streaming, the
 * check's import of 400 files took 522-656 s where it takes 44-113 s on most (it runs at the lowest priority while the
 * stream keeps both cores busy, by design), so the cases began 564-711 s after Drashti started, and the 12 minutes they
 * then had to stop by left them 10-156 s: 2, 8 and 17 rows of 41-46 measured. So the set-up and the import have their
 * own time, the cases theirs on top, and the check stops Drashti only after both and the figures' writing: a slow
 * runner's import is said in the summary (its length, as always) and never takes the cases' time.
 */

/** Drashti's start, the check's set-up and its import with the slide changes through it: up to this long. */
export const PERF_SETUP_MS = 14 * 60_000;
/**
 * The animations scenario's cases, from when they begin (its budget): about 410 s as pressed on every runner, Mac and
 * Windows, plain and streaming, its last row (DK-2) starting 384-391 s in (C2's budget pairs, 14 Nov 2026): a minute
 * in hand for a slow screen's warm-up.
 */
export const PERF_CASES_MS = 8 * 60_000;
/** Reading the screens' records and writing the figures, once the cases stop pressing. */
export const PERF_FIGURES_MS = 2 * 60_000;
/** A heavy check stops Drashti this long after starting it: its set-up and import, its cases and their figures. */
export const PERF_STOP_MS = PERF_SETUP_MS + PERF_CASES_MS + PERF_FIGURES_MS;
/**
 * The cases stop pressing once Drashti has been up this long, should their own time not be over yet (a set-up and an
 * import longer than theirs): so the figures are always read and written before the check stops Drashti.
 */
export const PERF_CASES_UP_TO_MS = PERF_STOP_MS - PERF_FIGURES_MS;
