import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../ui/cx';

/**
 * The room the rest of the column keeps under the LIVE block before the block gives up standing still: about three
 * rows of Audio, so what scrolls is still worth scrolling.
 */
export const LIVE_REST_MIN_PX = 140;

/**
 * The live column (alpha.20.2, the owner's "this stays still everything else is scrollable in this window"): the
 * LIVE block (the picture, Back and Next, what plays and its time, the levels) stands still at the top, and the rest
 * (Audio and what follows) scrolls on its own under it. A window too short to leave the rest LIVE_REST_MIN_PX scrolls
 * the whole column instead, as before, so nothing is ever out of reach. Positioned, both ways, so what is placed out
 * of the flow in it (Audio's lists' screen-reader status lines, select-many.tsx) is held and scrolled by what scrolls.
 */
export function LiveColumn({ still, rest }: { still: ReactNode; rest: ReactNode }) {
  const column = useRef<HTMLElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const [stands, setStands] = useState(true);
  useLayoutEffect(() => {
    const c = column.current;
    const b = block.current;
    if (!c || !b) return;
    // The block's own height is the same either way, so the choice never flips back and forth.
    const choose = () => {
      setStands(c.clientHeight - b.offsetHeight >= LIVE_REST_MIN_PX);
    };
    choose();
    const seen = new ResizeObserver(choose);
    seen.observe(c);
    seen.observe(b);
    return () => {
      seen.disconnect();
    };
  }, []);
  return (
    <aside
      ref={column}
      className={cx(
        'relative flex min-h-0 flex-1 flex-col',
        stands ? 'overflow-hidden' : 'overflow-y-auto pb-3',
      )}
      aria-label="Live"
      data-testid="live-column"
      data-still={stands ? 'true' : 'false'}
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
    </aside>
  );
}
