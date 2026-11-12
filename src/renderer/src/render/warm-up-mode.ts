/*
 * How a page warms its GPU up (Session 27, WarmUp.tsx), as the main process loaded it (windows/renderer.ts).
 */

const mode = new URLSearchParams(location.search).get('warmUp');

/**
 * Tests only: the warm-up stays drawn (never when packaged): to be looked at (DRASHTI_TEST_HOLD_WARM_UP), or until an
 * output is told it draws without a graphics chip (DRASHTI_TEST_GPU_SAID=late, Session 57).
 */
export const HOLD_WARM_UP = mode === 'hold' || mode === 'hold-till-told';

/** Tests only: an output's held warm-up ends when it is told it draws without a graphics chip (Session 57). */
export const NO_GPU_ENDS_HOLD = mode === 'hold-till-told';

/**
 * No warm-up: Drashti runs translated (an Intel build under Rosetta, x64 under Windows' emulation), where
 * the warm-up's drawing kept a screen busy for seconds at a time and gains nothing. The show draws at once.
 */
export const SKIP_WARM_UP = mode === 'skip';
