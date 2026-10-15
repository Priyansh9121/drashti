/*
 * The marks pages set in a Chromium trace (performance.mark; Session 27), which the Performance check reads
 * from its trace (src/main/perf-watch.ts, gpuPipelines): a page's GPU warm-up, from its start to `-end`, and
 * a screen's first Bold transition (the bold-transitions scenario), from its start to `-end`.
 */

export const WARM_UP_MARK = 'drashti-warm-up';
export const FIRST_BOLD_MARK = 'drashti-first-bold-transition';
