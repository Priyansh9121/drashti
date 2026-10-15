import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/*
 * Motion in the interface (Session 26g, Diya's "Rising"). Things arrive and leave; show controls,
 * thumbnails and the live picture never move. Every duration and easing is a token in app.css
 * (--dur-*, --ease-*): entrances are CSS (`data-motion` in app.css), and the two things CSS cannot
 * do read their timing from the same tokens here: a playlist row sliding to its new place, and a
 * leaving dialog, menu or notice playing its exit. With reduced motion nothing moves.
 */

const REDUCED = '(prefers-reduced-motion: reduce)';

/*
 * The window opens settled (Session 26g): whatever is there when it opens is simply there, and only
 * what arrives afterwards moves. Opening is when a computer without a graphics chip can least spare
 * the frames: Drashti starting, or starting again after a stop in the middle of a show while the
 * screens are put back. Settled once the page is first idle, or at the operator's first key or click.
 * The first start's welcome is the one arrival on opening: the lamp lighting is its point.
 */
let opened = false;

function settle(): void {
  opened = true;
}

if (typeof window !== 'undefined') {
  const whenIdle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(settle);
    else setTimeout(settle, 0);
  };
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
  window.addEventListener('pointerdown', settle, { once: true, capture: true });
  window.addEventListener('keydown', settle, { once: true, capture: true });
}

/**
 * How a thing arrives (its `data-motion`), decided once as it first appears: nothing while the window
 * is still opening, so it never starts moving later on.
 */
export function useArrival<T extends string>(kind: T | null): T | undefined {
  const [arrival] = useState(() => (kind !== null && opened ? kind : undefined));
  return arrival;
}

/** The computer asks for reduced motion: nothing in the interface moves. */
export function motionOff(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED).matches;
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

/** An easing token (--ease-out). */
export function easing(name: string): string {
  return tokenText(name) || 'ease-out';
}

/*
 * Leaving. When a dialog, a menu or a notice goes, React removes it at once; a copy of it then plays
 * its exit where it was (`data-leaving` in app.css, about 70% of its entrance) and goes. The copy is
 * drawn in a closed shadow root under an inert, aria-hidden host: it can't take the focus, be read
 * out, be clicked, block the show's keys (useKeymap looks for aria-modal in the page, which can't see
 * into it), or be found by anything querying the page.
 */

export type Leaving = 'dialog' | 'sheet' | 'pop' | 'notice';

let sheet: CSSStyleSheet | null = null;
let sheetFrom = -1;

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
    sheetFrom = count;
  }
  return [sheet];
}

/** Play `node`'s exit as a copy, where it is now. Call it just before React removes the node. */
export function leave(node: Element | null, kind: Leaving): void {
  if (!(node instanceof HTMLElement) || !node.isConnected || motionOff()) return;
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const seen = getComputedStyle(node);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.dataset['leavingHost'] = kind;
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.adoptedStyleSheets = pageStyles();
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('data-testid');
    el.removeAttribute('data-motion');
  }
  // A picture of it, never a player: a copied video or sound never loads or plays.
  for (const media of copy.querySelectorAll<HTMLMediaElement>('video, audio')) {
    media.removeAttribute('src');
    media.removeAttribute('autoplay');
    media.preload = 'none';
    for (const source of media.querySelectorAll('source')) source.remove();
  }
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
  });
  copy.dataset['leaving'] = kind;
  shadow.append(copy);
  document.body.append(host);
  const gone = () => {
    host.remove();
  };
  copy.addEventListener('animationend', (e) => {
    if (e.target === copy) gone();
  });
  // In case its animation never runs (a hidden window): never longer than its exit and a little.
  setTimeout(gone, duration('dur-exit') + 200);
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
