import { type RefObject, useLayoutEffect } from 'react';
import { type FitBox, queueFit } from './shrink-to-fit';

/*
 * A stage message that always fits its place (the owner, 24 Nov 2026): wherever it shows (the Standard stage screen's
 * own place, a layout's message box, the banner across the top, the audience picture with Stage off, and the
 * operator's previews of them), a message that fits stays exactly as it is, at the operator's chosen size. One that
 * would go past its place or the screen wraps at its words (a single word wider than the place breaks inside it, as
 * before), is centred in its place, and is drawn as large as still fits: the chosen size is the most, and it is made
 * smaller only as much as it must be.
 *
 * Its size is searched as a slide's shrink-to-fit is (render/shrink-to-fit.ts: the same halving, in the same batch as
 * the slide boxes drawn in the commit, right after it and before the browser draws), so a stage screen never shows the
 * message unfitted, and every stage screen shows it the same at the same moment. It is searched again when its words,
 * its size or its look change (the caller's `again`), when its place is given a new size (a window resized), and when
 * a font arrives.
 *
 * The place's element carries the fit as CSS custom properties its words' styles read (atMessageFit): none while the
 * message fits at its chosen size, so it draws exactly as before.
 */

/** How much smaller the message's words are drawn (unset: at its chosen size). */
export const MESSAGE_FIT = '--stage-message-fit';
/** While the words are made smaller: how they align across (centred), and up and down (centred). */
export const MESSAGE_ALIGN = '--stage-message-align';
export const MESSAGE_JUSTIFY = '--stage-message-justify';

/** A length (a CSS size: `64px`, `1.4em`) at the message's fit. */
export const atMessageFit = (size: string): string => `calc(${size} * var(${MESSAGE_FIT}, 1))`;

/** How a message's words align across: centred while made smaller, else as `otherwise` says (as before). */
export const messageAlign = (otherwise: string): string => `var(${MESSAGE_ALIGN}, ${otherwise})`;

/** Where a message sits up and down in its place: centred while made smaller, else as `otherwise` says. */
export const messageJustify = (otherwise: string): string => `var(${MESSAGE_JUSTIFY}, ${otherwise})`;

/** The element a message is fitted on (a stand-in in the unit tests). */
export interface MessagePlace {
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string;
  };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Element sizes as the browser lays them out. */
interface Scrolled {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/**
 * Whether a place's own words (and its padding round them) run past it, down or across: a place that grows with its
 * words up to a limit (the Standard stage screen's, the banner), drawn with its overflow hidden.
 */
export const runsPast = (place: Scrolled): boolean =>
  place.scrollHeight > place.clientHeight + 0.5 || place.scrollWidth > place.clientWidth + 0.5;

/** Whether a block of words runs past a place of a set size (a layout's message box). */
export const wordsPast = (
  place: Pick<Scrolled, 'clientHeight' | 'clientWidth'>,
  words: Pick<HTMLElement, 'offsetHeight' | 'scrollWidth'>,
): boolean => words.offsetHeight > place.clientHeight + 0.5 || words.scrollWidth > place.clientWidth + 0.5;

/**
 * A message's place as shrink-to-fit searches it: always on, from its chosen size (a fit of 1) down, never above it.
 * Drawn at a fit below 1 the place says so (data-message-fit) and centres its words; at 1, nothing is set.
 */
export function messageFitBox(place: MessagePlace, over: () => boolean): FitBox {
  return {
    on: true,
    write(fit) {
      if (fit === null || fit >= 1) place.style.removeProperty(MESSAGE_FIT);
      else place.style.setProperty(MESSAGE_FIT, String(fit));
    },
    over,
    settle(fit) {
      if (fit < 1) {
        place.setAttribute('data-message-fit', fit.toFixed(3));
        place.style.setProperty(MESSAGE_ALIGN, 'center');
        place.style.setProperty(MESSAGE_JUSTIFY, 'safe center');
      } else {
        place.removeAttribute('data-message-fit');
        place.style.removeProperty(MESSAGE_ALIGN);
        place.style.removeProperty(MESSAGE_JUSTIFY);
      }
    },
  };
}

/**
 * Fits a stage message to its place (`place`, its words measured by `over`, a function of the module's own: the same
 * every render): after each commit that changes `again` (its words, size and look), when the place's container is
 * given a new size, and when a font arrives.
 */
export function useStageMessageFit(
  place: RefObject<HTMLElement | null>,
  over: (place: HTMLElement) => boolean,
  again: unknown,
): void {
  useLayoutEffect(() => {
    const p = place.current;
    if (!p) return undefined;
    let forget: (() => void) | null = null;
    const fit = () => {
      forget?.();
      forget = queueFit(messageFitBox(p, () => over(p)));
    };
    fit();
    // A new size of the place's container (a window resized, a preview's box): measured again before it is drawn.
    const container = p.parentElement;
    let seen: string | null = null;
    const observer =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (!r) return;
            const size = `${String(r.width)}x${String(r.height)}`;
            if (seen !== null && seen !== size) fit();
            seen = size;
          })
        : null;
    if (container) observer?.observe(container);
    document.fonts.addEventListener('loadingdone', fit);
    return () => {
      forget?.();
      observer?.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    };
  }, [place, over, again]);
}
