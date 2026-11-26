import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { sinceShowChanged } from '../engine/show-changed';

/*
 * Motion in the interface (Session 26g, "Rising"; Session 40: Calm, Lively or Off, chosen in the Appearance
 * window). Things arrive and leave; show controls, thumbnails and the live picture never move. Every duration and easing is a token in app.css
 * (--dur-*, --ease-*): entrances are CSS (`data-motion` in app.css), and the two things CSS cannot
 * do read their timing from the same tokens here: a playlist row sliding to its new place, and a
 * leaving dialog, menu or notice playing its exit. With reduced motion nothing moves.
 */

const REDUCED = '(prefers-reduced-motion: reduce)';

/*
 * The window opens settled (Session 26g): whatever is there when it opens is simply there, and only
 * what arrives afterwards moves. Opening is when a computer without a graphics chip can least spare
 * the frames: Drashti starting, or starting again after a stop in the middle of a show while the
 * screens are put back. Opening lasts until the page has loaded and so has the window's first data
 * (holdOpening: an empty library or playlist list that comes with it is simply there too), and the
 * page is then first idle (within a second); or until the operator's first key or click. The first
 * start's welcome is the one arrival on opening: the lamp lighting is its point.
 */
let opened = false;
let loaded = false;
let holds = 0;

/** The window has opened: what arrives from now on moves (`data-opened` on the page says so). */
function settle(): void {
  opened = true;
  document.documentElement.dataset['opened'] = '';
}

function settleWhenIdle(): void {
  if (opened || !loaded || holds > 0) return;
  const idle = () => {
    if (holds === 0) settle();
  };
  // Within a second however busy the page is, so a window kept busy still settles.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(idle, { timeout: 1000 });
  else setTimeout(idle, 0);
}

if (typeof window !== 'undefined') {
  const whenLoaded = () => {
    loaded = true;
    settleWhenIdle();
  };
  if (document.readyState === 'complete') whenLoaded();
  else window.addEventListener('load', whenLoaded, { once: true });
  window.addEventListener('pointerdown', settle, { once: true, capture: true });
  window.addEventListener('keydown', settle, { once: true, capture: true });
}

/**
 * Keep the window opening while its first data loads; call what it returns when that is in (once is
 * enough; more is harmless). Take it as the window's code loads, before the page can be idle.
 */
export function holdOpening(): () => void {
  holds += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds -= 1;
    settleWhenIdle();
  };
}

/**
 * How a thing arrives (its `data-motion`), decided once as it first appears: nothing while the window
 * is still opening, so it never starts moving later on.
 */
export function useArrival<T extends string>(kind: T | null): T | undefined {
  const [arrival] = useState(() => (kind !== null && opened ? kind : undefined));
  return arrival;
}

/** The interface motion chosen in the Appearance window (Session 40), as the preload set it on <html>. */
function chosenMotion(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement.dataset['interfaceMotion'];
}

/** Nothing in the interface moves: the computer asks for reduced motion, or interface motion is Off. */
export function motionOff(): boolean {
  return (typeof matchMedia === 'function' && matchMedia(REDUCED).matches) || chosenMotion() === 'off';
}

/*
 * Lively (Session 40): more moves, never on a show control, and none started while the show is changing: a
 * slide change, Next to the next item, a clear, anything the engine says changed in the last QUIET_MS. Since alpha.24
 * (the release lead's review of uimotion, MUST-1; a new install starts in Lively) all of it waits for a graphics chip
 * known to be there: without one Lively moves as Calm does (app.css names data-chip on every Lively rule, and the
 * preload's cross-fade asks the same). Streaming on a slow computer, Moving: Off and a hidden window, which also hold a
 * live look's touch, do not hold it.
 */
export const QUIET_MS = 800;

/** What decides whether Lively moves now. */
export interface LivelyFacts {
  /** The interface motion chosen (data-interface-motion). */
  motion: string | undefined;
  /** Nothing moves: reduced motion, or Off (motionOff). */
  off: boolean;
  /** Whether Chromium draws with a graphics chip (data-chip: unknown until it has said). */
  chip: string | undefined;
  /** Milliseconds since the show last changed. */
  sinceShow: number;
}

/** Lively is chosen, the computer allows motion and has a graphics chip, and the show is quiet. */
export function livelyWith(f: LivelyFacts): boolean {
  return f.motion === 'lively' && !f.off && f.chip === 'yes' && f.sinceShow > QUIET_MS;
}

/** Lively moves now (livelyWith, as the page is). */
export function livelyNow(): boolean {
  return livelyWith({
    motion: chosenMotion(),
    off: motionOff(),
    chip: typeof document === 'undefined' ? undefined : document.documentElement.dataset['chip'],
    sinceShow: sinceShowChanged(),
  });
}

/**
 * Whether what `key` names arrives in Lively (a playlist just opened): for a moment after the key changes, once
 * the window has opened, while Lively is on and the show is quiet. Its cards take `data-lively="arrive"` and
 * their place as `--i` (app.css), one after another.
 */
export function useLivelyArrival(key: string | null): boolean {
  // Decided as it first draws and as the key changes (during render): nothing while the window is opening.
  const [seen, setSeen] = useState<{ key: string | null; arriving: boolean }>(() => ({
    key,
    arriving: key !== null && opened && livelyNow(),
  }));
  if (seen.key !== key) setSeen({ key, arriving: key !== null && opened && livelyNow() });
  useEffect(() => {
    if (!seen.arriving) return;
    const done = setTimeout(
      () => {
        setSeen((s) => ({ ...s, arriving: false }));
      },
      duration('dur-arrive') + 8 * duration('stagger-arrive') + 200,
    );
    return () => {
      clearTimeout(done);
    };
  }, [seen]);
  return seen.arriving && seen.key === key;
}

/**
 * Glide `el` from where `from` was to where it is now (Lively, Session 40): a tab's underline, a chosen row's
 * highlight. Only a transform, over --dur-glide on --ease-glide; nothing when Lively is not on or the show is
 * changing.
 */
export function glideFrom(el: HTMLElement | null, from: DOMRect | null): void {
  if (!el || !from || !livelyNow()) return;
  const to = el.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  el.animate(
    [
      {
        transformOrigin: '0 0',
        transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(sx)}, ${String(sy)})`,
      },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: duration('dur-glide'), easing: easing('ease-glide') },
  );
}

/** A token's value, as app.css sets it on the page. */
function tokenText(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/** A duration token in milliseconds (--dur-move: 180ms). */
export function duration(name: string): number {
  const text = tokenText(name);
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return 0;
  return text.endsWith('ms') ? n : n * 1000;
}

/** A number token (--lively-time: 1.25), or 1 when there is none. */
export function tokenNumber(name: string): number {
  const n = Number.parseFloat(tokenText(name));
  return Number.isFinite(n) ? n : 1;
}

/** An easing token (--ease-out). */
export function easing(name: string): string {
  return tokenText(name) || 'ease-out';
}

/**
 * A list's chosen row: its highlight glides from the row chosen before (Lively, Session 40). A highlight drawn
 * like the row's own (`look`, its classes) moves from `from` to `to` by transform alone, under the rows, while the
 * list holds `data-gliding` (app.css keeps the row's own highlight back till it arrives); then it goes. The list
 * is the highlight's frame (position: relative).
 */
export function glideHighlight(
  list: HTMLElement | null,
  from: DOMRect | null,
  to: HTMLElement | null,
  look: string,
): void {
  if (!list || !from || !to || !livelyNow()) return;
  const frame = list.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  if (end.height === 0 || Math.abs(from.top - end.top) < 1) return;
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.className = look;
  Object.assign(mark.style, {
    position: 'absolute',
    zIndex: '-1',
    pointerEvents: 'none',
    left: `${String(end.left - frame.left + list.scrollLeft)}px`,
    top: `${String(end.top - frame.top + list.scrollTop)}px`,
    width: `${String(end.width)}px`,
    height: `${String(end.height)}px`,
  });
  list.dataset['gliding'] = '';
  list.prepend(mark);
  const done = () => {
    mark.remove();
    delete list.dataset['gliding'];
  };
  const glide = mark.animate(
    [
      {
        transform: `translateY(${String(from.top - end.top)}px) scaleY(${String(from.height / end.height)})`,
        transformOrigin: '0 0',
      },
      { transform: 'none', transformOrigin: '0 0' },
    ],
    { duration: duration('dur-glide'), easing: easing('ease-glide') },
  );
  glide.addEventListener('finish', done);
  glide.addEventListener('cancel', done);
}

/*
 * Leaving. When a dialog, a menu or a notice goes, React removes it at once; a copy of it then plays
 * its exit where it was (`data-leaving` in app.css, about 70% of its entrance) and goes. The copy is
 * drawn in a closed shadow root under an inert, aria-hidden host: it can't take the focus, be read
 * out, be clicked, block the show's keys (useKeymap looks for aria-modal in the page, which can't see
 * into it), or be found by anything querying the page.
 */

export type Leaving = 'dialog' | 'sheet' | 'pop' | 'notice' | 'fold' | 'fold-lively';

/**
 * Where a section's folded insides leave (alpha.24, ui/fold.ts): over their column on its own background, so the
 * sections moved up under them show only as the copy goes, and clipped to the column's scrolling part (never over
 * the layer bar or LIVE's block); under the window's overlays.
 */
export interface LeavingPlace {
  clip: string;
  background: string;
}

/** A section's copy sits just over the column, under menus, notices and dialogs. */
const FOLD_LAYER = 5;

let sheet: CSSStyleSheet | null = null;
let sheetFrom = -1;

/** A selector list's selectors, split at its own commas (never at those inside brackets). */
function selectorsOf(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let part = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(part.trim());
      part = '';
    } else part += ch;
  }
  if (part.trim() !== '') out.push(part.trim());
  return out;
}

/**
 * A selector list without its :host parts (none left: one that matches nothing). A copy's shadow root takes the page's
 * styles, and Tailwind's `:root, :host { --color-* }` would set the default appearance's colours on its host, over the
 * appearance <html> carries (lead 2's hands-on pass of uilook, problem 1): without them the host inherits the window's.
 */
export function hostless(selector: string): string {
  const kept = selectorsOf(selector).filter((s) => !/:host\b/u.test(s));
  return kept.length > 0 ? kept.join(', ') : ':not(*)';
}

/** Every style rule of these, however deep in layers and groups, with its :host parts taken out. */
function dropHost(rules: CSSRuleList): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const kept = hostless(rule.selectorText);
      if (kept !== rule.selectorText) rule.selectorText = kept;
    }
    if ('cssRules' in rule) dropHost((rule as CSSGroupingRule).cssRules);
  }
}

/** The page's own styles, for the copy's shadow root (made once; again if the page's styles change). */
function pageStyles(): CSSStyleSheet[] {
  const count = document.styleSheets.length;
  if (!sheet || sheetFrom !== count) {
    const text: string[] = [];
    for (const s of document.styleSheets) {
      try {
        for (const rule of s.cssRules) text.push(rule.cssText);
      } catch {
        // A style sheet from elsewhere can't be read; Drashti has none.
      }
    }
    sheet = new CSSStyleSheet();
    sheet.replaceSync(text.join('\n'));
    // The copy draws in the window's own appearance, never the default one's (hostless).
    dropHost(sheet.cssRules);
    sheetFrom = count;
  }
  return [sheet];
}

/** Play `node`'s exit as a copy, where it is now. Call it just before React removes the node. */
export function leave(node: Element | null, kind: Leaving, place?: LeavingPlace): void {
  if (!(node instanceof HTMLElement) || !node.isConnected || motionOff()) return;
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const seen = getComputedStyle(node);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.dataset['leavingHost'] = kind;
  // In its own layer when it has one, so a dialog that goes under Keep these screens? leaves under it too
  // (Session 51); otherwise over everything.
  const layer = Number.parseInt(seen.zIndex, 10);
  host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${String(place ? FOLD_LAYER : Number.isNaN(layer) ? 70 : layer)}`;
  if (place) host.style.clipPath = place.clip;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.adoptedStyleSheets = pageStyles();
  const copy = node.cloneNode(true) as HTMLElement;
  // Where its scrolling parts were scrolled to (a copy starts at their tops): set again once it is drawn.
  const originals = [node, ...node.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  const scrolled = originals.flatMap((el, i) => {
    const to = copies[i];
    return to && (el.scrollTop !== 0 || el.scrollLeft !== 0)
      ? [{ to, top: el.scrollTop, left: el.scrollLeft }]
      : [];
  });
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('data-testid');
    el.removeAttribute('data-motion');
  }
  // A picture of it, never a player: a copied video or sound never loads or plays, and a page in it never loads.
  for (const media of copy.querySelectorAll<HTMLMediaElement>('video, audio')) {
    media.removeAttribute('src');
    media.removeAttribute('autoplay');
    media.preload = 'none';
    for (const source of media.querySelectorAll('source')) source.remove();
  }
  for (const page of copy.querySelectorAll('iframe, webview, object, embed')) page.remove();
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${String(box.left)}px`,
    top: `${String(box.top)}px`,
    width: `${String(box.width)}px`,
    height: `${String(box.height)}px`,
    margin: '0',
    translate: 'none',
    color: seen.color,
    fontFamily: seen.fontFamily,
    fontSize: seen.fontSize,
    lineHeight: seen.lineHeight,
    ...(place ? { backgroundColor: place.background, overflow: 'hidden' } : {}),
  });
  copy.dataset['leaving'] = kind;
  shadow.append(copy);
  document.body.append(host);
  for (const { to, top, left } of scrolled) {
    to.scrollTop = top;
    to.scrollLeft = left;
  }
  const gone = () => {
    host.remove();
  };
  copy.addEventListener('animationend', (e) => {
    if (e.target === copy) gone();
  });
  // In case its animation never runs (a hidden window): never longer than its exit and a little (Lively's longer).
  setTimeout(gone, duration('dur-exit') * tokenNumber('lively-time') + 200);
}

/** An element that plays its exit when it goes: give it this ref. */
export function useLeaving<T extends HTMLElement>(kind: Leaving): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    // Its root element stays the same while it is open.
    const node = ref.current;
    return () => {
      leave(node, kind);
    };
  }, [kind]);
  return ref;
}

/*
 * A row moving Up or Down (a playlist item): the list is drawn in its new order at once, then each
 * row that moved slides from where it was to where it is, over --dur-move.
 */

/** Where each row of a list is now, by its attribute (data-item-row="<id>"). */
export function rowTops(list: HTMLElement | null, attribute: string): Map<string, number> {
  const tops = new Map<string, number>();
  for (const row of list?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])
    tops.set(row.getAttribute(attribute) ?? '', row.getBoundingClientRect().top);
  return tops;
}

/** Slide the rows that moved since `before` (rowTops) to their new places. */
export function slideRows(list: HTMLElement | null, attribute: string, before: Map<string, number>): void {
  if (motionOff()) return;
  const time = duration('dur-move');
  const curve = easing('ease-out');
  for (const row of list?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? []) {
    const was = before.get(row.getAttribute(attribute) ?? '');
    if (was === undefined) continue;
    const by = was - row.getBoundingClientRect().top;
    if (Math.abs(by) < 1) continue;
    row.animate([{ transform: `translateY(${String(by)}px)` }, { transform: 'none' }], {
      duration: time,
      easing: curve,
    });
  }
}
