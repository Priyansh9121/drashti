import { describe, expect, it } from 'vitest';
import {
  movedPin,
  pinKey,
  QUICK_BAR_MAX,
  type QuickPin,
  quickPinsSchema,
  readQuickBar,
  withoutPin,
  withPin,
} from './quick-bar';

/*
 * The quick bar (Session 55, Part 8): up to 8 pinned items, kept in the library's settings. What is kept is read
 * forgivingly (a pin it can't read is left out, never the whole bar), and a change is checked whole by the main process.
 */

const picture: QuickPin = {
  kind: 'media',
  mediaId: 'm-picture',
  media: 'image',
  label: 'Placeholder backdrop',
};
const slide: QuickPin = {
  kind: 'slide',
  presentationId: 'p-words',
  slideId: 's-two',
  playlistId: 'pl-1',
  itemId: 'it-words',
  label: 'Placeholder words_2',
};
const row: QuickPin = { kind: 'item', playlistId: 'pl-1', itemId: 'it-video', label: 'Placeholder clip' };
const message: QuickPin = { kind: 'message', templateId: 'msg-1', label: 'Placeholder welcome' };

const many = (n: number): QuickPin[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'media' as const,
    mediaId: `m-${String(i)}`,
    media: 'video' as const,
    label: `Placeholder ${String(i)}`,
  }));

describe('the quick bar’s pins', () => {
  it('holds up to 8, a key each, never the same thing twice', () => {
    expect(QUICK_BAR_MAX).toBe(8);
    const keys = [picture, slide, row, message].map(pinKey);
    expect(new Set(keys).size).toBe(4);
    // The same slide from the library's chosen presentation (no playlist row) is another pin.
    expect(pinKey({ ...slide, playlistId: null, itemId: null })).not.toBe(pinKey(slide));
    expect(quickPinsSchema.safeParse(many(8)).success).toBe(true);
    expect(quickPinsSchema.safeParse(many(9)).success).toBe(false);
  });

  it('reads what was kept forgivingly: none, a broken pin, too many, the same twice', () => {
    expect(readQuickBar(undefined)).toEqual([]);
    expect(readQuickBar('not a list')).toEqual([]);
    expect(readQuickBar([picture, { kind: 'prop', id: 'x' }, slide, null, row, message])).toEqual([
      picture,
      slide,
      row,
      message,
    ]);
    expect(readQuickBar([picture, picture, row])).toEqual([picture, row]);
    expect(readQuickBar(many(12))).toEqual(many(8));
    // A label too long is cut, never the pin lost.
    const long = readQuickBar([{ ...message, label: 'x'.repeat(500) }]);
    expect(long).toHaveLength(1);
    expect(long[0]?.label.length).toBeLessThanOrEqual(120);
  });

  it('pins at the end, once; a full bar says so', () => {
    expect(withPin([], picture)).toEqual({ pins: [picture], full: false });
    expect(withPin([picture], picture)).toEqual({ pins: [picture], full: false });
    expect(withPin([picture], row).pins).toEqual([picture, row]);
    const full = many(8);
    expect(withPin(full, message)).toEqual({ pins: full, full: true });
  });

  it('takes one off, and moves one a place left or right', () => {
    const pins = [picture, slide, row, message];
    expect(withoutPin(pins, pinKey(slide))).toEqual([picture, row, message]);
    expect(withoutPin(pins, 'nothing')).toEqual(pins);
    expect(movedPin(pins, pinKey(row), -1)).toEqual([picture, row, slide, message]);
    expect(movedPin(pins, pinKey(row), 1)).toEqual([picture, slide, message, row]);
    // At an end it stays.
    expect(movedPin(pins, pinKey(picture), -1)).toEqual(pins);
    expect(movedPin(pins, pinKey(message), 1)).toEqual(pins);
  });
});
