import { useLayoutEffect, type RefObject } from 'react';
import type { CaptionPlace } from '../../../shared/captions';
import type { Size } from '../../../shared/scaling';

const OCCUPIED =
  '[data-testid="lower-third-layer"], [data-testid="lower-third"], [data-layer="messages"], [data-message-box], [data-testid="ticker"]';

/** Measure existing bands only when their content/size changes. Ignore entrance transforms: reserve their final place. */
export function useCaptionAvoidance(
  root: RefObject<HTMLDivElement | null> | undefined,
  band: RefObject<HTMLDivElement | null>,
  canvas: Size,
  place: CaptionPlace | undefined,
  lift: number,
  content: string,
): void {
  useLayoutEffect(() => {
    const screen = root?.current;
    const element = band.current;
    if (!screen || !element || !place) return;
    const gap = Math.round(canvas.height * 0.02);
    const edge = Math.round(canvas.height * 0.04);
    const occupied = () => [...screen.querySelectorAll<HTMLElement>(OCCUPIED)];
    const measure = () => {
      if (!element.isConnected) return;
      const height = element.offsetHeight;
      const regions = occupied()
        .flatMap((box) => {
          if (!box.offsetHeight || !box.offsetWidth) return [];
          let top = box.offsetTop;
          let parent = box.offsetParent as HTMLElement | null;
          while (parent && parent !== screen) {
            top += parent.offsetTop;
            parent = parent.offsetParent as HTMLElement | null;
          }
          return [{ top, bottom: top + box.offsetHeight }];
        })
        .sort((a, b) => (place === 'bottom' ? b.top - a.top : a.bottom - b.bottom));
      let top = place === 'bottom' ? canvas.height - edge - lift - height : edge;
      for (const box of regions) {
        if (top + height + gap <= box.top || top - gap >= box.bottom) continue;
        top = place === 'bottom' ? box.top - gap - height : box.bottom + gap;
      }
      element.style.top = `${String(Math.round(top))}px`;
      element.style.bottom = 'auto';
      element.style.visibility = top < edge || top + height > canvas.height - edge ? 'hidden' : '';
    };
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      for (const box of occupied()) resize.observe(box);
      measure();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(screen, { childList: true, subtree: true });
    observe();
    return () => {
      mutation.disconnect();
      resize.disconnect();
    };
  }, [root, band, canvas.height, canvas.width, place, lift, content]);
}
