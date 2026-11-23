import { create } from 'zustand';

/**
 * Where the notices stand (alpha.21, the fit pass: a notice floating over the live column covered its controls, the
 * levels' Sound on and Audio's buttons): the live column's foot, which LiveColumn gives while it is up, so a notice
 * takes its room from what scrolls under the LIVE block and lies over nothing; null without one (the practice show),
 * where they float in the window's bottom-right corner as before.
 */
export const useNoticePlace = create<{ place: HTMLElement | null }>(() => ({ place: null }));
