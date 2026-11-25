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
 * FACES_BOUND_MS the room is set as soon as the flow's own faces are in (they settle, loaded or failed: never measured
 * without them), without waiting longer for the rest. Set once either way.
 *
 * The width is the panel's own, never its scrolling body's scrollbar (review S18, CI's Mac): a scrollbar that takes
 * room came while the room was not set yet and went once the area grew to fit, and the room, measured again a line
 * shorter, moved the area after Next could be pressed. The copies are laid out at the lines' width with the
 * scrollbar shown, whether or not it shows then, so the room fits the lines either way.
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
  /** The panel's own width now (a change of it, and only that, measures again): never its body's scrollbar. */
  widthOf(box: ReserveBox): number;
  /** Lay the copies out, before each measure, at the lines' width with the body's scrollbar shown. */
  layOut?(box: ReserveBox): void;
  /** Load the faces the copies' words need: settles once each is loaded or failed. */
  loadFonts(copies: Iterable<Measured>): Promise<void>;
  /** The document's fonts ready: every load in the window, the flow's or not, settled. */
  fontsReady?(): Promise<void>;
  marginTop(el: Measured): number;
  /** Settles once the layout has taken what loaded (a frame later). */
  afterLayout?(): Promise<void>;
  /** Call `fire` once, after `ms` (a timer); returns its stop. */
  timer(ms: number, fire: () => void): () => void;
}

/**
 * What set the room: the faces, the document's fonts and the layout came; the bound came first (then the flow's own
 * faces); or the panel's width changed.
 */
export type ReserveBy = 'faces' | 'bound' | 'width';

/**
 * The longest Back, Next, Now and Next up wait for the rest once the flow's own faces are in (review S18): the document's
 * fonts (every load in the window) and the layout's frames. A bound on a wait, the kind of alpha.22's 1 s valve on the
 * stream's hold, not another path: the same measuring, sooner. Three times the app's half second before a wait is said
 * (LOADING_AFTER_MS, ui/States.tsx): "Getting Now and Next up ready…" is said from half a second, the controls come by
 * a second and a half once the faces are in. The flow's own faces it never cuts short (CI's Mac, S18: a slow runner's
 * faces came after it, and a room measured without them was another): local files, they settle, loaded or failed.
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
 * Watch the copies in `box`: once their faces have loaded, the document's fonts are ready and the layout has taken them,
 * or by FACES_BOUND_MS once their own faces are in, say the room they need (px) and what set it, once; again only when
 * the panel's own width changes. Returns the stop (a new PDF, the panel folded): nothing is said after it.
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
  let facesIn = false;
  let bound = false;
  let width = Number.NaN;
  const measure = (by: ReserveBy) => {
    deps.layOut?.(box);
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
  // The room, set once: what comes after it measures nothing again (only a new width does).
  const setRoom = (by: ReserveBy) => {
    if (stopped || loaded) return;
    loaded = true;
    stopBound();
    width = deps.widthOf(box);
    measure(by);
  };
  const stopBound = deps.timer(FACES_BOUND_MS, () => {
    bound = true;
    if (facesIn) setRoom('bound');
  });
  const faces = deps.loadFonts([...nows, ...nexts]).catch(() => undefined);
  void faces.then(() => {
    facesIn = true;
    if (bound) setRoom('bound');
  });
  void faces
    .then(() => deps.fontsReady?.())
    .catch(() => undefined)
    // The layout takes what loaded a frame later: measured after it, never before.
    .then(() => deps.afterLayout?.())
    .catch(() => undefined)
    .then(() => {
      setRoom('faces');
    });
  return () => {
    stopped = true;
    stopBound();
    stopWatching();
  };
}

/** What the window's widths need of an element (an HTMLElement's own). */
export interface Laid {
  readonly parentElement: Laid | null;
  readonly offsetWidth: number;
  readonly clientWidth: number;
}

/** What the window's widths need of an element's computed style. */
export interface LaidStyle {
  overflowY: string;
  borderLeftWidth: string;
  borderRightWidth: string;
  right: string;
}

/** The nearest element above `el` that scrolls up and down (the panel's body): null if none. */
function scrollerOf(el: Laid, styleOf: (el: Laid) => LaidStyle): Laid | null {
  for (let up = el.parentElement; up; up = up.parentElement) {
    const overflow = styleOf(up).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return up;
  }
  return null;
}

/** The room `el`'s own scrollbar takes now (0: none shown, or one drawn over its content). */
function scrollbarOf(el: Laid, styleOf: (el: Laid) => LaidStyle): number {
  const st = styleOf(el);
  const borders = (parseFloat(st.borderLeftWidth) || 0) + (parseFloat(st.borderRightWidth) || 0);
  return Math.max(0, el.offsetWidth - el.clientWidth - borders);
}

/**
 * The panel's own width, which only a resized column or window changes: the border box of the body it scrolls in, the
 * same whether that body's scrollbar shows or not; the box's own where nothing above it scrolls.
 */
export function panelWidthOf(box: Laid, styleOf: (el: Laid) => LaidStyle): number {
  return (scrollerOf(box, styleOf) ?? box).offsetWidth;
}

/**
 * The copies' right margin (px, 0 or less) that lays them out at the lines' width with the body's scrollbar shown,
 * whether or not it shows now: they keep a scrollbar's room of their own (scrollbar-gutter: stable), so while the
 * body's shows they reach out over its room, never past their own inset (nothing to scroll sideways).
 */
export function copiesMargin(box: Laid, styleOf: (el: Laid) => LaidStyle): number {
  const scroller = scrollerOf(box, styleOf);
  if (!scroller) return 0;
  const reach = Math.min(scrollbarOf(scroller, styleOf), parseFloat(styleOf(box).right) || 0);
  return reach > 0 ? -reach : 0;
}

/** An element's computed style, as the window's widths read it. */
const laidStyle = (el: Laid): LaidStyle =>
  el instanceof Element
    ? getComputedStyle(el)
    : { overflowY: 'visible', borderLeftWidth: '0', borderRightWidth: '0', right: '0' };

/**
 * The window's own: a ResizeObserver on the box, the panel's width, the copies laid out, the document's fonts, each
 * copy's top margin, a timer.
 */
export function windowReserveDeps(): ReserveDeps {
  return {
    observe: (targets, changed) => {
      const observer = new ResizeObserver(changed);
      for (const target of targets) if (target instanceof Element) observer.observe(target);
      return () => {
        observer.disconnect();
      };
    },
    widthOf: (box) => (box instanceof HTMLElement ? panelWidthOf(box, laidStyle) : 0),
    layOut: (box) => {
      if (box instanceof HTMLElement) box.style.marginRight = `${String(copiesMargin(box, laidStyle))}px`;
    },
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
      // Each face settles, loaded or failed: one that fails is drawn in its stand-in, as the lines are.
      await Promise.allSettled(
        facesToLoad(elements, nodeOf).map(([font, text]) => document.fonts.load(font, text)),
      );
    },
    fontsReady: async () => {
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
