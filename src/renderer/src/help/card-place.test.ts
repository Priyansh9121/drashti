import { describe, expect, it } from 'vitest';
import type { Box, CardRoom } from './card-place';
import { CARD_GAP, placeCard } from './card-place';

/*
 * Where a "What is this?" card opens (alpha.24, helpcards; lead 2's a25 list, items 20, 22 and 26): over the window,
 * not in its flow, so nothing moves as it opens (it had pushed Back, Next, Oops and the live picture down 110 to 362 px,
 * or lifted the bottom bar 171 px), and whole in sight in the columns' area, under the top bar and above the bars at the
 * bottom (Stage's had opened with its top under the top bar at 1024 × 645). It opens in the middle column where it can,
 * so LIVE's column (the live picture, Back, Next, Oops) and the show controls along the bottom are never under it: a ?
 * in the left or the right column opens it beside that column, level with the ?; any other ? under or over itself.
 */

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

/** CI's 1024 × 645 window: the top bar 48 px, the bars along the bottom from 560 px; left 220, middle, right 300. */
const AREA = box(0, 48, 1024, 560);
const LEFT = box(0, 48, 220, 560);
const MIDDLE = box(228, 48, 716, 560);
const RIGHT = box(724, 48, 1024, 560);
const CARD = { width: 320, height: 150 };

const room = (ask: Box, zone: CardRoom['zone'], card = CARD): CardRoom => ({
  ask,
  zone,
  area: AREA,
  middle: MIDDLE,
  card,
});

const right = (p: { left: number }, card = CARD) => p.left + card.width;

describe('where a ? card opens', () => {
  it('a ? in LIVE’s column: in the middle, against LIVE’s column, level with the ?', () => {
    const p = placeCard(room(box(990, 200, 1014, 224), 'right'));
    expect(right(p)).toBe(MIDDLE.right - CARD_GAP);
    expect(p.top).toBe(200);
    expect(p.maxHeight).toBeNull();
  });

  it('a ? in the left column: in the middle, against the left column, level with the ?', () => {
    const p = placeCard(room(box(190, 300, 214, 324), 'left'));
    expect(p.left).toBe(MIDDLE.left + CARD_GAP);
    expect(p.top).toBe(300);
  });

  it('a ? in the top bar over LIVE’s column: under the top bar, in the middle, clear of LIVE’s column', () => {
    const p = placeCard(room(box(900, 14, 920, 34), null));
    expect(p.top).toBe(AREA.top + CARD_GAP);
    expect(right(p)).toBeLessThanOrEqual(RIGHT.left);
    expect(right(p)).toBe(MIDDLE.right - CARD_GAP);
  });

  it('a ? in the bars along the bottom: just over them, in the middle', () => {
    const p = placeCard(room(box(990, 600, 1014, 624), null));
    expect(p.top + CARD.height).toBe(AREA.bottom - CARD_GAP);
    expect(right(p)).toBe(MIDDLE.right - CARD_GAP);
  });

  it('a ? in the middle: under it, lined up with it on the middle’s side it is on', () => {
    const early = placeCard(room(box(300, 60, 324, 84), 'middle'));
    expect(early.top).toBe(84 + CARD_GAP);
    expect(early.left).toBe(300);
    const late = placeCard(room(box(680, 60, 704, 84), 'middle'));
    expect(late.top).toBe(84 + CARD_GAP);
    expect(right(late)).toBe(704);
  });

  it('a ? low in the middle, with no room under it: over it', () => {
    const p = placeCard(room(box(300, 500, 324, 524), 'middle'));
    expect(p.top + CARD.height).toBe(500 - CARD_GAP);
  });

  it('a ? low in a column: the card ends above the bars, never under them', () => {
    const p = placeCard(room(box(990, 520, 1014, 544), 'right'));
    expect(p.top + CARD.height).toBe(AREA.bottom - CARD_GAP);
  });

  it('a ? scrolled part-way under the top bar (Stage’s at 1024 × 645): the card starts under the top bar, whole', () => {
    const p = placeCard(room(box(990, 36, 1014, 60), 'right'));
    expect(p.top).toBe(AREA.top + CARD_GAP);
  });

  it('a card taller than the room: from the area’s top, as tall as the room, scrolling in itself', () => {
    const tall = { width: 320, height: 700 };
    const p = placeCard(room(box(990, 200, 1014, 224), 'right', tall));
    expect(p.top).toBe(AREA.top + CARD_GAP);
    expect(p.maxHeight).toBe(AREA.bottom - AREA.top - 2 * CARD_GAP);
  });

  it('with no columns (another window’s parts): inside the window, by its ?', () => {
    const p = placeCard({
      ask: box(990, 200, 1014, 224),
      zone: null,
      area: box(0, 0, 1024, 645),
      middle: null,
      card: CARD,
    });
    expect(right(p)).toBe(1014);
    expect(p.top).toBe(224 + CARD_GAP);
    expect(p.left).toBeGreaterThanOrEqual(CARD_GAP);
  });

  it('a middle too narrow for the card: inside the area, never past the window’s edge', () => {
    const p = placeCard({ ...room(box(990, 200, 1014, 224), 'right'), middle: box(228, 48, 500, 560) });
    expect(p.left).toBeGreaterThanOrEqual(AREA.left + CARD_GAP);
    expect(right(p)).toBeLessThanOrEqual(AREA.right - CARD_GAP);
  });

  it('on whole pixels', () => {
    const p = placeCard(room(box(990.4, 200.6, 1014.4, 224.6), 'right'));
    expect(Number.isInteger(p.left)).toBe(true);
    expect(Number.isInteger(p.top)).toBe(true);
  });
});
