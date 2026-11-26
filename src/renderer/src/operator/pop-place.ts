import { create } from 'zustand';

/**
 * Where the chat popup stands (alpha.24, QA24-CHATPOP-1; the review's MUST 1): the middle column's foot, which Columns
 * gives while it is up. The middle column ends just above the quick bar and the bar of clears, so the card lies over
 * the middle only, over no pinned show button, no button of the bar of clears, and neither side column (the left one's
 * Undo, the live column's notices). Null without the columns (the practice show), where the popup stands centred just
 * above the quick bar instead.
 */
export const usePopPlace = create<{ place: HTMLElement | null }>(() => ({ place: null }));

/** The place's ref (one function, so React gives it once): the place while it is up, given back as it goes. */
export function popPlaceRef(el: HTMLDivElement | null): (() => void) | undefined {
  if (!el) return undefined;
  usePopPlace.setState({ place: el });
  return () => {
    if (usePopPlace.getState().place === el) usePopPlace.setState({ place: null });
  };
}
