/*
 * How a page warms its GPU up (Session 27, WarmUp.tsx), as the main process loaded it (windows/renderer.ts).
 */

const mode = new URLSearchParams(location.search).get('warmUp');

/** Tests only: the warm-up stays drawn, to be looked at (DRASHTI_TEST_HOLD_WARM_UP; never when packaged). */
export const HOLD_WARM_UP = mode === 'hold';

/**
 * No warm-up: Drashti runs translated (an Intel build under Rosetta, x64 under Windows' emulation), where
 * the warm-up's drawing kept a screen busy for seconds at a time and gains nothing. The show draws at once.
 */
export const SKIP_WARM_UP = mode === 'skip';
