import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../ui/cx';
import { blockAsItStands } from './live-stand';
import { useNoticePlace } from './notice-place';

/**
 * The room the rest of the column keeps under the LIVE block before the block gives up standing still: about three
 * rows of Audio, so what scrolls is still worth scrolling.
 */
export const LIVE_REST_MIN_PX = 140;

/**
 * The notices' most (alpha.21, the review of the fit pass: four import notices, one more and a notice pushed Back and
 * Next out of CI's 1024 × 645 window, and in a shorter one cut off the last card's Dismiss): the room under the LIVE
 * block and no more than 40 % of the column, but always the last card whole (and this much at least); past it they
 * scroll on their own, from their end, so the last card is the one in sight.
 */
export const NOTICES_MIN_PX = 72;
const NOTICES_SHARE = 0.4;

/** The last card's height in the notices' place (a notice, or an import's line), with the place's own room around it. */
function lastCard(place: HTMLElement): number {
  const area = place.firstElementChild;
  const last = [
    ...place.querySelectorAll('[data-testid="operator-notice"], [data-testid="import-notice"]'),
  ].at(-1);
  if (!(area instanceof HTMLElement) || !(last instanceof HTMLElement)) return 0;
  const style = getComputedStyle(area);
  return last.offsetHeight + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
}

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
  const scroller = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const [stands, setStands] = useState(true);
  useLayoutEffect(() => {
    const c = column.current;
    const s = scroller.current;
    const b = block.current;
    const f = foot.current;
    if (!c || !s || !b || !f) return;
    // The block judged by its height as it stands (alpha.24, live-stand.ts): a scrollbar beside it while the whole
    // column scrolls narrows it and its picture, so judged as it is then the choice would flip back and forth.
    const choose = () => {
      const picture = b.querySelector<HTMLElement>('[data-testid="live-preview"]');
      const height = blockAsItStands({
        block: b.offsetHeight,
        scrollbar: s.offsetWidth - s.clientWidth,
        picture: picture ? { width: picture.offsetWidth, height: picture.offsetHeight } : null,
      });
      const most = Math.max(
        NOTICES_MIN_PX,
        lastCard(f),
        Math.min(c.clientHeight * NOTICES_SHARE, c.clientHeight - height),
      );
      f.style.maxHeight = `${String(Math.floor(most))}px`;
      setStands(c.clientHeight - f.offsetHeight - height >= LIVE_REST_MIN_PX);
    };
    choose();
    const seen = new ResizeObserver(choose);
    seen.observe(c);
    seen.observe(s);
    seen.observe(b);
    seen.observe(f);
    // A notice coming or going, which may not change the place's own size once it is at its most.
    const told = new MutationObserver(choose);
    told.observe(f, { childList: true, subtree: true });
    // The notices' place while this column is up.
    useNoticePlace.setState({ place: f });
    return () => {
      seen.disconnect();
      told.disconnect();
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
        ref={scroller}
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
      {/* The notices (operator/StatusBar.tsx, NoticeArea), when there are any: from their end (column-reverse), so the
          last card is in sight when they scroll. */}
      <div
        ref={foot}
        className="flex shrink-0 flex-col-reverse overflow-x-hidden overflow-y-auto"
        data-testid="notice-place"
      />
    </aside>
  );
}
