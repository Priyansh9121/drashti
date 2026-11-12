import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEditablePptx } from '../import/deck/editable-pptx';
import * as nativeImport from '../import/deck/native-deck-import';
import { makeTestDeck, placeholderDeckMedia, type TestDeckSlide } from '../import/testing/make-deck';
import { makeTestPptx } from '../import/testing/make-pptx';
import { readEditableWithTiming } from './pptx-source-timing';

/* W6's review N4: the document reader reads a page's clicks as alpha.17's import does. Generated decks only. */

const INCH = 914_400;
const words = (id: number, text: string, y: number) => ({
  id,
  type: 'text' as const,
  name: `Placeholder box ${String(id)}`,
  x: INCH,
  y: y * INCH,
  w: 10 * INCH,
  h: INCH,
  paras: [{ text, size: 28, color: 'FFFFFF' }],
});
const SLIDES: TestDeckSlide[] = [
  {
    key: 'clicks',
    bg: '204060',
    transition: { kind: 'fade', dur: 400 },
    notes: 'Placeholder notes one',
    shapes: [words(2, 'Placeholder first words', 1), words(3, 'Placeholder click words', 4)],
    effects: [
      { kind: 'fade', target: 3, dur: 500, start: 'click' },
      { kind: 'exit-fade', target: 3, dur: 300, start: 'click' },
    ],
  },
  {
    key: 'more-clicks',
    bg: '305020',
    transition: { kind: 'fade', dur: 600 },
    notes: 'Placeholder notes two',
    shapes: [words(4, 'Placeholder second words', 2)],
    effects: [{ kind: 'fade', target: 4, dur: 700, start: 'click' }],
  },
];

const roots: string[] = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-source-timing-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function deckFile(bytes: Buffer): string {
  const file = join(folder(), 'Placeholder deck.pptx');
  writeFileSync(file, bytes);
  return file;
}

describe('the document reader’s clicks for a slide imported before alpha.17', () => {
  it('reads the asked pages’ clicks and transition, beside the same editable copy', async () => {
    const file = deckFile(makeTestDeck(SLIDES, placeholderDeckMedia()));
    const timed = await readEditableWithTiming(file, folder(), [0]);
    const plain = await readEditablePptx(file, folder());
    expect(timed.editable.slides).toEqual(plain.slides);
    expect(timed.editable.media.map((m) => m.kind)).toEqual(plain.media.map((m) => m.kind));
    expect([timed.editable.width, timed.editable.height, timed.editable.sourceCount]).toEqual([
      plain.width,
      plain.height,
      plain.sourceCount,
    ]);
    expect([...timed.decks.keys()]).toEqual([0]);
    const deck = timed.decks.get(0);
    expect(deck?.steps).toEqual([]);
    expect(deck?.motion?.approximate).toBe(false);
    expect(deck?.motion?.stepsMs).toHaveLength(3);
    expect(
      deck?.motion?.effects.map(({ shapeId, step, phase, kind }) => ({ shapeId, step, phase, kind })),
    ).toEqual([
      { shapeId: '3', step: 1, phase: 'in', kind: 'fade' },
      { shapeId: '3', step: 2, phase: 'out', kind: 'fade' },
    ]);
    expect(deck?.transition).toMatchObject({ durationMs: 400, nativeTransition: { kind: 'dissolve' } });
    // Every asked page, and only those.
    const both = await readEditableWithTiming(file, folder(), [1, 0]);
    expect([...both.decks.keys()].sort()).toEqual([0, 1]);
    expect(both.decks.get(1)?.motion?.effects.map((effect) => effect.shapeId)).toEqual(['4']);
  });

  it('keeps the editable copy but leaves a page that needs its still out of the timing map', async () => {
    const prepare = nativeImport.prepareNativePptx;
    const prepareWithMissingMedia = vi
      .spyOn(nativeImport, 'prepareNativePptx')
      .mockImplementationOnce(async (...args) => {
        const result = await prepare(...args);
        const page = result?.pages.get(0);
        if (!page) throw new Error('The placeholder page was not prepared');
        page.needsStill = true;
        return result;
      });
    try {
      const file = deckFile(makeTestDeck(SLIDES, placeholderDeckMedia()));
      const timed = await readEditableWithTiming(file, folder(), [0, 1]);
      expect(timed.editable.slides.map((slide) => slide.sourceIndex)).toEqual([0, 1]);
      expect([...timed.decks.keys()]).toEqual([1]);
    } finally {
      prepareWithMissingMedia.mockRestore();
    }
  });

  it('reads the editable copy alone when no page is asked, or nothing in the deck moves', async () => {
    const file = deckFile(makeTestDeck(SLIDES, placeholderDeckMedia()));
    const none = await readEditableWithTiming(file, folder(), []);
    expect(none.decks.size).toBe(0);
    expect(none.editable.slides).toEqual((await readEditablePptx(file, folder())).slides);
    const still = deckFile(makeTestPptx([{ text: 'Placeholder still words', color: '204060' }]));
    const stillRead = await readEditableWithTiming(still, folder(), [0]);
    expect(stillRead.decks.size).toBe(0);
    expect(stillRead.editable.slides).toEqual((await readEditablePptx(still, folder())).slides);
  });

  it('refuses what the editable reader refuses', async () => {
    const broken = deckFile(Buffer.from('Placeholder bytes that are not a deck'));
    await expect(readEditablePptx(broken, folder())).rejects.toThrow();
    await expect(readEditableWithTiming(broken, folder(), [0])).rejects.toThrow();
  });
});
