/*
 * Sabha flow (alpha.23): the panel's steady room for Now and Next up (review S16, S17): the tallest Now and the tallest
 * Next up of all the flow's items, from unseen copies (FlowNowNext.tsx). Measured as the copies are first laid out,
 * again whenever the box or any copy changes size (the panel's width, a copy's words), and again whenever a font has
 * loaded: the bundled Gujarati and Devanagari faces load by unicode-range only once their letters are first drawn,
 * after the first measure, and make the lines taller. Never left short.
 */

export interface Measured {
  getBoundingClientRect(): { height: number };
}

export interface ReserveBox {
  querySelectorAll(selector: string): Iterable<Measured>;
}

export interface ReserveDeps {
  /** Watch these for a change of size; `changed` is called once as watching starts, and on every change. */
  observe(targets: readonly unknown[], changed: () => void): () => void;
  /** The document's fonts (their 'loadingdone' says a font has loaded); none in a test that has no fonts. */
  fonts?: {
    addEventListener(type: 'loadingdone', listener: () => void): void;
    removeEventListener(type: 'loadingdone', listener: () => void): void;
  };
  marginTop(el: Measured): number;
  /** The box's width now (a change of it, and only that, measures again). */
  widthOf?(box: ReserveBox): number;
  /** Load the faces the copies' words need (then the document's fonts are ready). */
  loadFonts?(copies: Iterable<Measured>): Promise<void>;
}

/** Watch the copies in `box`, saying the room they need (px) each time it is measured; returns the stop. */
export function watchReserve(
  box: ReserveBox,
  onReserve: (px: number) => void,
  deps: ReserveDeps,
): () => void {
  const nows = [...box.querySelectorAll('[data-measure="now"]')];
  const nexts = [...box.querySelectorAll('[data-measure="next"]')];
  const measure = () => {
    let now = 0;
    let next = 0;
    for (const el of nows) now = Math.max(now, el.getBoundingClientRect().height);
    for (const el of nexts) next = Math.max(next, el.getBoundingClientRect().height + deps.marginTop(el));
    onReserve(Math.ceil(now + next));
  };
  const stop = deps.observe([box, ...nows, ...nexts], measure);
  deps.fonts?.addEventListener('loadingdone', measure);
  return () => {
    stop();
    deps.fonts?.removeEventListener('loadingdone', measure);
  };
}

/** The window's own: a ResizeObserver, the document's fonts, each copy's top margin. */
export function windowReserveDeps(): ReserveDeps {
  const fonts = document.fonts;
  return {
    observe: (targets, changed) => {
      const observer = new ResizeObserver(changed);
      for (const target of targets) if (target instanceof Element) observer.observe(target);
      return () => {
        observer.disconnect();
      };
    },
    fonts: {
      addEventListener: (type, listener) => {
        fonts.addEventListener(type, listener);
      },
      removeEventListener: (type, listener) => {
        fonts.removeEventListener(type, listener);
      },
    },
    marginTop: (el) => (el instanceof Element ? parseFloat(getComputedStyle(el).marginTop) || 0 : 0),
  };
}
