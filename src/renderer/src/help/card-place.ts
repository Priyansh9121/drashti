/*
 * Where a "What is this?" card opens (alpha.24, helpcards; lead 2's a25 list, items 20, 22 and 26): over the window, not
 * in its flow, so nothing moves as it opens (in the flow it pushed Back, Next, Oops and the live picture down 110 to
 * 362 px, or lifted the bottom bar and the quick bar's pins 151 to 171 px), and whole in sight in the columns' area,
 * under the top bar and over the bars along the bottom (Stage's opened with its top under the top bar at 1024 × 645).
 * It opens in the middle column where the middle has room for it, so LIVE's column (the live picture, Back, Next, Oops)
 * and the show controls along the bottom are never under it: a ? in the left or the right column opens it beside that
 * column, level with the ?; any other ? (the middle's, the top bar's, the bottom bar's and the status bar's) under it,
 * or over it when there is no room under it, lined up with it. WhatIsThis.tsx measures the window; this only decides.
 */

/** A box in the window, in CSS px (a DOMRect's own parts). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a card's place is decided from. */
export interface CardRoom {
  /** The ?'s box. */
  ask: Box;
  /** The column the ? is in (operator/Layout.tsx's data-zone), or null: the top bar, the bottom bar, the status bar. */
  zone: 'left' | 'middle' | 'right' | null;
  /** Where a card may be: the columns' area (the top bar's foot to the bottom bar's top), or the window without them. */
  area: Box;
  /** The middle column, or null (none in this window): then the area. */
  middle: Box | null;
  /** The card's own size, drawn whole. */
  card: { width: number; height: number };
}

/** Where the card goes: its top left corner, and the most it may be tall (null: as tall as its words). */
export interface CardPlace {
  left: number;
  top: number;
  maxHeight: number | null;
}

/** The space between a card and its ?, and between a card and the edges of where it may be (px). */
export const CARD_GAP = 8;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

export function placeCard({ ask, zone, area, middle, card }: CardRoom): CardPlace {
  const g = CARD_GAP;
  // Across: in the middle, or (a middle too narrow for it) anywhere in the area.
  const within = middle ?? area;
  let lo = within.left + g;
  let hi = within.right - g - card.width;
  if (hi < lo) {
    lo = area.left + g;
    hi = area.right - g - card.width;
  }
  const centre = (ask.left + ask.right) / 2;
  const leftward = centre > (within.left + within.right) / 2;
  const x = zone === 'left' ? lo : zone === 'right' ? hi : leftward ? ask.right - card.width : ask.left;
  // Down: whole between the area's top and foot; level with a ? beside it, else under its ? or over it.
  const top = area.top + g;
  const foot = area.bottom - g;
  const room = foot - top;
  let y: number;
  let maxHeight: number | null = null;
  if (card.height > room) {
    y = top;
    maxHeight = Math.max(0, room);
  } else if (zone === 'left' || zone === 'right') y = clamp(ask.top, top, foot - card.height);
  else {
    const under = ask.bottom + g;
    const over = ask.top - g - card.height;
    if (under + card.height <= foot) y = Math.max(under, top);
    else if (over >= top) y = Math.min(over, foot - card.height);
    else y = ask.top - top > foot - ask.bottom ? top : foot - card.height;
  }
  return { left: Math.round(clamp(x, lo, hi)), top: Math.round(y), maxHeight };
}
