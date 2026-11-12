import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deckSlideAt } from '../../../shared/deck-show';
import { readPptxDeck } from '../pictures';
import { makeTestDeck, placeholderDeckMedia } from '../testing/make-deck';
import { nativePresentation, prepareNativePptx } from './native-deck-import';

it('shows each paragraph of a paragraph build from its own click, never before, until its exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'drashti-paragraph-build-'));
  try {
    const file = join(root, 'Placeholder paragraph build.pptx');
    await writeFile(
      file,
      makeTestDeck(
        [
          {
            key: 'placeholder-paragraphs',
            bg: '244060',
            transition: { kind: 'fade', dur: 200 },
            notes: '',
            shapes: [
              {
                id: 2,
                type: 'text',
                name: 'Placeholder points',
                x: 914_400,
                y: 914_400,
                w: 5_486_400,
                h: 2_743_200,
                paras: [
                  { text: 'Placeholder first point', bullet: true },
                  { text: 'Placeholder second point', bullet: true },
                ],
              },
            ],
            effects: [
              { kind: 'fade', target: 2, para: 0, dur: 240, start: 'click' },
              { kind: 'fade', target: 2, para: 1, dur: 260, start: 'click' },
              { kind: 'exit-fade', target: 2, para: 0, dur: 180, start: 'click' },
              { kind: 'exit-fade', target: 2, para: 1, dur: 200, start: 'click' },
            ],
          },
        ],
        placeholderDeckMedia(),
      ),
    );
    const deck = await readPptxDeck(file);
    const prepared = await prepareNativePptx(deck, file, root);
    expect(prepared?.exact).toBe(false);
    const parsed = prepared && nativePresentation('Placeholder paragraph build.pptx', deck, prepared);
    const first = parsed?.groups[0]?.slides[0];
    if (!parsed || !first) throw new Error('The generated paragraph slide was not read.');
    const slide = { ...first, id: 'placeholder', width: parsed.width, height: parsed.height };
    expect(first.deck).toMatchObject({
      steps: [],
      motion: { approximate: true, stepsMs: [0, 240, 260, 180, 200] },
    });
    expect(first.deck?.motion?.effects).toMatchObject([
      { shapeId: '2', step: 1, phase: 'in', paragraphs: [0, 0] },
      { shapeId: '2', step: 2, phase: 'in', paragraphs: [1, 1] },
      { shapeId: '2', step: 3, phase: 'out', paragraphs: [0, 0] },
      { shapeId: '2', step: 4, phase: 'out', paragraphs: [1, 1] },
    ]);
    /** What each paragraph's words show as at the end of a click ('' when the box isn't drawn at all). */
    const drawn = (step: number) => {
      const box = deckSlideAt(slide, step).elements.find((el) => el.kind === 'text');
      return box?.kind === 'text'
        ? (box.runs ?? [])
            .filter((run) => run.text.trim() !== '')
            .map((run) => `${run.text.trim()}: ${run.color === 'transparent' ? 'hidden' : 'shown'}`)
        : '';
    };
    expect(drawn(0)).toBe('');
    expect(drawn(1)).toEqual(['Placeholder first point: shown', 'Placeholder second point: hidden']);
    expect(drawn(2)).toEqual(['Placeholder first point: shown', 'Placeholder second point: shown']);
    expect(drawn(3)).toEqual(['Placeholder first point: hidden', 'Placeholder second point: shown']);
    expect(drawn(4)).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
