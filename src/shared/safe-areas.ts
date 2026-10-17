/*
 * The slide editor's guides for where words are safe (Sessions 31–36, SLD-2): action-safe and title-safe
 * (93% and 90% of the slide, centred: the HD standard), the ticker's band along the bottom, and a message's
 * band above it. The screens draw the ticker and messages by these too (render/Scene.tsx).
 */

/** The ticker's band: this much of a screen's height, along its bottom. */
export const TICKER_HEIGHT = 0.075;

/** A message's words: this much of a screen's height (render/Scene.tsx's banner). */
export const MESSAGE_TEXT = 0.045;

/**
 * A message's band, about: one line of its words at their line height (about 1.36 of their size), with half
 * their size above and below. A guide's line, not a measure: a long message takes two.
 */
export const MESSAGE_BAND = MESSAGE_TEXT * 2.36;

/** Action-safe: inside this much of the slide (centred), everything a screen might show. */
export const ACTION_SAFE = 0.93;

/** Title-safe: inside this much (centred), the words. */
export const TITLE_SAFE = 0.9;
