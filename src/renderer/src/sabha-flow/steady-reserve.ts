/*
 * Sabha flow (alpha.23): the panel's steady room for Now and Next up (review S16, lead 2 after CI's Mac): the tallest Now
 * and the tallest Next up of all the flow's items, from unseen copies (FlowNowNext.tsx). Set ONCE per flow, before Now
 * and Next can be used: first the faces the copies' words need are loaded (the bundled Gujarati and Devanagari faces
 * load by unicode-range, late on a slow computer), then it is measured. A font loaded later, or a copy alone, never
 * moves it while the flow is current: on CI's Mac a late face grew it on the operator's first Next and moved the
 * playlists. Only a new width (a resized column) measures it again; a new PDF starts afresh.
 *
 * The wait has a bound (review S18): `document.fonts.ready` waits for every load in the window, and a minimized window
 * draws no frame, so a load that never settled left the operator no Now and Next controls for that flow. By
 * FACES_BOUND_MS the room is set with the faces there then; if the faces and the layout come after it, it is measured
 * once more, the way a new width is, and then only on a new width.
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
  /** Call `fire` once, after `ms` (a timer); returns its stop. */
  timer(ms: number, fire: () => void): () => void;
}

/** What set the room: the faces and the layout came, the bound came first, or the box's width changed. */
export type ReserveBy = 'faces' | 'bound' | 'width';

/**
 * The longest Back, Next, Now and Next up stay unseen while the faces load and the layout takes them (review S18); then
 * the room is set with the faces there. A bound on a wait, the kind of alpha.22's 1 s valve on the stream's hold, not
 * another path: the same measuring, sooner. Three times the app's half second before a wait is said (LOADING_AFTER_MS,
 * ui/States.tsx): "Getting Now and Next up ready…" is said from half a second, the controls come by a second and a
 * half, so an operator who chose a PDF mid-sabha waits a moment at most, and the faces (local files, asked by name)
 * have many times their usual time to come first.
 */
export const FACES_BOUND_MS = 1500;

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
 * Watch the copies in `box`: once their faces have loaded and the layout has taken them, or at FACES_BOUND_MS with
 * the faces there then, say the room they need (px) and what set it; once more if the faces come after the bound; again
 * only when the box's width changes. Returns the stop (a new PDF, the panel folded): nothing is said after it.
 */
export function watchReserve(
  box: ReserveBox,
  onReserve: (px: number, by: ReserveBy) => void,
  deps: ReserveDeps,
): () => void {
  const nows = [...box.querySelectorAll('[data-measure="now"]')];
  const nexts = [...box.querySelectorAll('[data-measure="next"]')];
  let stopped = false;
  let loaded = false;
  let width = Number.NaN;
  const measure = (by: ReserveBy) => {
    let now = 0;
    let next = 0;
    for (const el of nows) now = Math.max(now, el.getBoundingClientRect().height);
    for (const el of nexts) next = Math.max(next, el.getBoundingClientRect().height + deps.marginTop(el));
    onReserve(Math.ceil(now + next), by);
  };
  const stopWatching = deps.observe([box], () => {
    const w = deps.widthOf(box);
    if (w === width) return;
    const first = Number.isNaN(width);
    width = w;
    if (loaded && !first && !stopped) measure('width');
  });
  const setRoom = (by: ReserveBy) => {
    if (stopped) return;
    loaded = true;
    width = deps.widthOf(box);
    measure(by);
  };
  const stopBound = deps.timer(FACES_BOUND_MS, () => {
    if (!loaded) setRoom('bound');
  });
  void deps
    .loadFonts([...nows, ...nexts])
    .catch(() => undefined)
    // The layout takes what loaded a frame later: measured after it, never before.
    .then(() => deps.afterLayout?.())
    .catch(() => undefined)
    .then(() => {
      stopBound();
      // In time: the room, set once. After the bound: measured once more with the faces it was set without.
      setRoom('faces');
    });
  return () => {
    stopped = true;
    stopBound();
    stopWatching();
  };
}

/** The window's own: a ResizeObserver on the box, its width, the document's fonts, each copy's top margin, a timer. */
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
    // A hidden window's timers still run (slowed to once a second), where its frames stop.
    timer: (ms, fire) => {
      const t = setTimeout(fire, ms);
      return () => {
        clearTimeout(t);
      };
    },
  };
}
