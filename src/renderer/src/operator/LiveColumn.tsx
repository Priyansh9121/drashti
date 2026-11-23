import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../ui/cx';
import { useNoticePlace } from './notice-place';

/**
 * The room the rest of the column keeps under the LIVE block before the block gives up standing still: about three
 * rows of Audio, so what scrolls is still worth scrolling.
 */
export const LIVE_REST_MIN_PX = 140;

/**
 * The notices' most (alpha.21, the review of the fit pass: four import notices, one more and a notice pushed Back and
 * Next out of CI's 1024 × 645 window, and in a shorter one cut off the last card's Dismiss): the room under the LIVE
 * block and no more than 40 % of the column, but always this much, about one notice; past it they scroll on their own.
 */
export const NOTICES_MIN_PX = 72;
const NOTICES_SHARE = 0.4;

/**
 * The live column (alpha.20.2, the owner's "this stays still everything else is scrollable in this window"): the
 * LIVE block (the picture, Back and Next, what plays and its time, the levels) stands still at the top, and the rest
 * (Audio and what follows) scrolls on its own under it. A window too short to leave the rest LIVE_REST_MIN_PX scrolls
 * the whole column instead, as before, so nothing is ever out of reach. Positioned, both ways, so what is placed out
 * of the flow in it (Audio's lists' screen-reader status lines, select-many.tsx) is held and scrolled by what scrolls.
 *
 * The notices stand at its foot (alpha.21, the fit pass: floating over the column, a long one covered its controls):
 * they take their room from what scrolls, never from the LIVE block (NOTICES_MIN_PX: at most the room under it), and
 * the column's own box never changes, so nothing moves as one comes and goes and nothing is ever under one.
 */
export function LiveColumn({ still, rest }: { still: ReactNode; rest: ReactNode }) {
  const column = useRef<HTMLElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const [stands, setStands] = useState(true);
  useLayoutEffect(() => {
    const c = column.current;
    const b = block.current;
    const f = foot.current;
    if (!c || !b || !f) return;
    // The block's own height is the same either way, so the choice never flips back and forth.
    const choose = () => {
      const most = Math.max(
        NOTICES_MIN_PX,
        Math.min(c.clientHeight * NOTICES_SHARE, c.clientHeight - b.offsetHeight),
      );
      f.style.maxHeight = `${String(Math.floor(most))}px`;
      setStands(c.clientHeight - f.offsetHeight - b.offsetHeight >= LIVE_REST_MIN_PX);
    };
    choose();
    const seen = new ResizeObserver(choose);
    seen.observe(c);
    seen.observe(b);
    seen.observe(f);
    // The notices' place while this column is up.
    useNoticePlace.setState({ place: f });
    return () => {
      seen.disconnect();
      if (useNoticePlace.getState().place === f) useNoticePlace.setState({ place: null });
    };
  }, []);
  return (
    <aside
      ref={column}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-label="Live"
      data-testid="live-column"
      data-still={stands ? 'true' : 'false'}
    >
      <div
        className={cx(
          'relative flex min-h-0 flex-1 flex-col',
          stands ? 'overflow-hidden' : 'overflow-y-auto pb-3',
        )}
        data-testid="live-scroll"
      >
        <div ref={block} className="shrink-0" data-testid="live-still">
          {still}
        </div>
        <div
          className={cx(
            'relative border-t border-line',
            stands ? 'min-h-0 flex-1 overflow-y-auto pb-3' : 'shrink-0',
          )}
          data-testid="live-rest"
        >
          {rest}
        </div>
      </div>
      {/* The notices (operator/StatusBar.tsx, NoticeArea), when there are any. */}
      <div ref={foot} className="shrink-0 overflow-x-hidden overflow-y-auto" data-testid="notice-place" />
    </aside>
  );
}
