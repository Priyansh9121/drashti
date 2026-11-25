/*
 * Sabha flow (alpha.23): the panel's steady room for Now and Next up (review S16, lead 2 after CI's Mac): the tallest Now
 * and the tallest Next up of all the flow's items, from unseen copies (FlowNowNext.tsx). Set ONCE per flow, before Now
 * and Next can be used: first the faces the copies' words need are loaded (the bundled Gujarati and Devanagari faces
 * load by unicode-range, late on a slow computer), then it is measured. A font loaded later, or a copy alone, never
 * moves it while the flow is current: on CI's Mac a late face grew it on the operator's first Next and moved the
 * playlists. Only a new width (a resized column) measures it again; a new PDF starts afresh.
 */

import { cutText } from '../../../shared/text';

export interface Measured {
  getBoundingClientRect(): { height: number };
}

export interface ReserveBox {
  querySelectorAll(selector: string): Iterable<Measured>;
}

export interface ReserveDeps {
  /** Watch these for a change of size; `changed` is called once as watching starts, and on every change. */
  observe(targets: readonly unknown[], changed: () => void): () => void;
  /** The box's width now (a change of it, and only that, measures again). */
  widthOf(box: ReserveBox): number;
  /** Load the faces the copies' words need (then the document's fonts are ready). */
  loadFonts(copies: Iterable<Measured>): Promise<void>;
  marginTop(el: Measured): number;
  /** Settles once the layout has taken what loaded (a frame later). */
  afterLayout?(): Promise<void>;
}

/** What a face's loading needs of an element: its own font, its own words (not its children's), its children. */
export interface FaceNode {
  font: string;
  text: string;
  children: readonly FaceNode[];
}

/**
 * The faces the copies' words need: [font, words] for each face, each once, in the order first met. Each element with
 * words of its own counts with its own font (a part in another script, or with a lang of its own, may draw in another
 * face than its line), so every face the words need, and the subset by unicode-range their letters fall in, is asked.
 */
export function facesToLoad<T>(copies: Iterable<T>, nodeOf: (el: T) => FaceNode): [string, string][] {
  const words = new Map<string, string>();
  const walk = (n: FaceNode) => {
    if (n.text.trim() !== '') words.set(n.font, cutText((words.get(n.font) ?? '') + n.text, 20_000));
    for (const child of n.children) walk(child);
  };
  for (const el of copies) walk(nodeOf(el));
  return [...words];
}

/**
 * Watch the copies in `box`: once their faces have loaded, say the room they need (px), and again only when the box's
 * width changes. Returns the stop (a new PDF, the panel folded): nothing is said after it.
 */
export function watchReserve(
  box: ReserveBox,
  onReserve: (px: number) => void,
  deps: ReserveDeps,
): () => void {
  const nows = [...box.querySelectorAll('[data-measure="now"]')];
  const nexts = [...box.querySelectorAll('[data-measure="next"]')];
  let stopped = false;
  let loaded = false;
  let width = Number.NaN;
  const measure = () => {
    let now = 0;
    let next = 0;
    for (const el of nows) now = Math.max(now, el.getBoundingClientRect().height);
    for (const el of nexts) next = Math.max(next, el.getBoundingClientRect().height + deps.marginTop(el));
    onReserve(Math.ceil(now + next));
  };
  const stopWatching = deps.observe([box], () => {
    const w = deps.widthOf(box);
    if (w === width) return;
    const first = Number.isNaN(width);
    width = w;
    if (loaded && !first && !stopped) measure();
  });
  void deps
    .loadFonts([...nows, ...nexts])
    .catch(() => undefined)
    // The layout takes what loaded a frame later: measured after it, never before.
    .then(() => deps.afterLayout?.())
    .catch(() => undefined)
    .then(() => {
      if (stopped) return;
      loaded = true;
      width = deps.widthOf(box);
      measure();
    });
  return () => {
    stopped = true;
    stopWatching();
  };
}

/** The window's own: a ResizeObserver on the box, its width, the document's fonts, each copy's top margin. */
export function windowReserveDeps(): ReserveDeps {
  return {
    observe: (targets, changed) => {
      const observer = new ResizeObserver(changed);
      for (const target of targets) if (target instanceof Element) observer.observe(target);
      return () => {
        observer.disconnect();
      };
    },
    widthOf: (box) => (box instanceof Element ? box.getBoundingClientRect().width : 0),
    loadFonts: async (copies) => {
      const nodeOf = (el: Element): FaceNode => {
        const st = getComputedStyle(el);
        let text = '';
        for (const child of el.childNodes)
          if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
        return {
          font: `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`,
          text,
          children: [...el.children].map(nodeOf),
        };
      };
      const elements = [...copies].filter((el): el is Element & Measured => el instanceof Element);
      await Promise.all(facesToLoad(elements, nodeOf).map(([font, text]) => document.fonts.load(font, text)));
      await document.fonts.ready;
    },
    afterLayout: () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
    marginTop: (el) => (el instanceof Element ? parseFloat(getComputedStyle(el).marginTop) || 0 : 0),
  };
}
