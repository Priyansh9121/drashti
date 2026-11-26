import './motion.css';
import { sinceShowChanged } from '../engine/show-changed';
import { duration, easing, leave, motionOff, QUIET_MS, tokenNumber } from './motion';

/*
 * A section's fold (alpha.24, uimotion; the owner's QA24-UI-3: "a complete redesign doesnt have to move around
 * features ... a more interactive and more animated, more transitions"). A section under LIVE (and every panel that
 * folds) moves as its heading's button is pressed, never as it is folded or unfolded by anything else:
 *  - Calm: its insides fade in (--dur-open); folding, a copy of them fades out where they were (--dur-exit, on
 *    --ease-in), over the column on its own background. No box moves: the layout is final in the frame the press
 *    lands, so nothing that measures the window (operator-fit, guides, the fit specs) can catch a fold half-open.
 *  - Lively: its insides unroll from the top (clip and opacity, --lively-time longer) while what is under the
 *    section glides from where it was to its new place (transform), in step, so the section seems to grow; folding,
 *    the copy rolls up as the rest glides up. Never when what would glide holds a show control (an open Lower Thirds
 *    or Picture in Picture): then it is where it goes at once, as a show control never moves.
 * It moves only when a live look's touch may (shared/appearance/moving.ts, the release lead's rule for anything new):
 * the window opened settled, interface motion not Off and the computer not set to reduce motion, a graphics chip
 * known to be there; and, as Lively's glides, not while the show is changing.
 */

export type FoldMove = 'calm' | 'lively';

/** What decides it. */
export interface FoldFacts {
  /** The window has opened settled (ui/motion.ts). */
  opened: boolean;
  /** The interface motion chosen (data-interface-motion). */
  motion: string | undefined;
  /** Nothing moves: reduced motion, or Off (motionOff). */
  off: boolean;
  /** Whether Chromium draws with a graphics chip (data-chip: unknown until it has said). */
  chip: string | undefined;
  /** Milliseconds since the show last changed. */
  sinceShow: number;
}

/** How a fold moves now: Calm's or Lively's, or not at all. */
export function foldMove(f: FoldFacts): FoldMove | null {
  if (!f.opened || f.off || f.motion === 'off' || f.chip !== 'yes' || f.sinceShow <= QUIET_MS) return null;
  return f.motion === 'lively' ? 'lively' : 'calm';
}

/** The operator window's newer motion as the page is now (a fold, a tab's panel arriving). */
export function newMotionNow(): FoldMove | null {
  const root = document.documentElement.dataset;
  return foldMove({
    opened: root['opened'] !== undefined,
    motion: root['interfaceMotion'],
    off: motionOff(),
    chip: root['chip'],
    sinceShow: sinceShowChanged(),
  });
}

/** How far each part glides from: where it was less where it is, by its place in both lists; none it cannot pair. */
export function glides(before: readonly number[], after: readonly number[]): number[] {
  if (before.length !== after.length) return after.map(() => 0);
  return after.map((top, i) => {
    const by = (before[i] ?? top) - top;
    return Math.abs(by) < 1 ? 0 : Math.round(by * 10) / 10;
  });
}

/** A clip of the window to `box` (the column's scrolling part), as a clip-path. */
export function clipInside(
  box: { top: number; right: number; bottom: number; left: number },
  window: { width: number; height: number },
): string {
  const px = (n: number) => `${String(Math.max(0, Math.round(n)))}px`;
  return `inset(${px(box.top)} ${px(window.width - box.right)} ${px(window.height - box.bottom)} ${px(box.left)})`;
}

/** The part of the window that scrolls or clips `el`: the live column's sections, or none (the window). */
function clipperOf(el: Element | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at && at !== document.body; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if (y === 'auto' || y === 'scroll' || y === 'hidden' || y === 'clip') return at;
  }
  return null;
}

/** A colour's opacity, from its computed value (rgb(), rgba(), or a / alpha). */
function alphaOf(colour: string): number {
  const slash = /\/\s*([0-9.]+)(%?)\s*\)$/u.exec(colour);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/u.exec(colour);
  if (rgba) return Number(rgba[1]);
  return colour === 'transparent' ? 0 : 1;
}

/** What is drawn behind `el`: the first background on it or around it that hides what is under it. */
function backgroundOf(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor;
    if (alphaOf(colour) >= 0.99) return colour;
  }
  return 'var(--color-panel)';
}

/** The section and everything after it in the column, up to its scrolling part: what a fold moves. */
function partsFrom(section: HTMLElement, clipper: HTMLElement | null): HTMLElement[] {
  const parts: HTMLElement[] = [section];
  for (let at: Element | null = section; at && at !== clipper && at !== document.body; at = at.parentElement)
    for (let next = at.nextElementSibling; next; next = next.nextElementSibling)
      if (next instanceof HTMLElement) parts.push(next);
  return parts;
}

const holdsShowControl = (parts: readonly HTMLElement[]) =>
  parts.some((p) => p.hasAttribute('data-show-control') || p.querySelector('[data-show-control]') !== null);

/**
 * Lively: once React has drawn the fold (before the next frame is painted), what moved glides from where it was, over
 * the insides' own time and curve.
 */
function glideAfter(section: HTMLElement, clipper: HTMLElement | null, opening: boolean): void {
  const parts = partsFrom(section, clipper);
  if (holdsShowControl(parts)) return;
  const before = parts.map((p) => p.getBoundingClientRect().top);
  const time = duration(opening ? 'dur-open' : 'dur-exit') * tokenNumber('lively-time');
  const curve = easing(opening ? 'ease-out' : 'ease-in');
  requestAnimationFrame(() => {
    if (holdsShowControl(parts)) return;
    const by = glides(
      before,
      parts.map((p) => p.getBoundingClientRect().top),
    );
    parts.forEach((part, i) => {
      const from = by[i] ?? 0;
      if (from === 0 || !part.isConnected) return;
      part.animate([{ transform: `translateY(${String(from)}px)` }, { transform: 'none' }], {
        duration: time,
        easing: curve,
      });
    });
  });
}

/**
 * A fold's button pressed (a click, or Enter): call it just before the section opens or folds. It plays the fold's
 * motion and says how the insides arrive if it is opening (the body's data-fold: Calm's or Lively's), or null.
 */
export function pressFold(button: HTMLElement, opening: boolean, bodyId: string): FoldMove | null {
  const move = newMotionNow();
  if (move === null) return null;
  const section = button.closest('section');
  const clipper = clipperOf(section);
  const body = opening ? null : document.getElementById(bodyId);
  if (body) {
    const box = clipper?.getBoundingClientRect() ?? {
      top: 0,
      right: innerWidth,
      bottom: innerHeight,
      left: 0,
    };
    leave(body, move === 'lively' ? 'fold-lively' : 'fold', {
      clip: clipInside(box, { width: innerWidth, height: innerHeight }),
      background: backgroundOf(body),
    });
  }
  if (move === 'lively' && section) glideAfter(section, clipper, opening);
  return move;
}
