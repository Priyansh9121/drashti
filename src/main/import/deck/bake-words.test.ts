import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { makeTestPptx } from '../testing/make-pptx';
import { bakeDeck, stepsCheckedLine } from './bake';
import type { CutPlan } from './cut';

/*
 * A deck's movie in words. Why it was not made, as its report says it (C17's review, L3): "PowerPoint could not make
 * the deck’s movie (…)", where an error thrown while it was made is never the reason: its own words go to the log.
 * And the log's line on the steps found in the movie (C10's review, LOW 6): the furthest step from its moment, and
 * the furthest of those kept, which is what the import's notice says.
 */

it('keeps a thrown error’s own words for the log, the reason saying only that an error stopped it', async () => {
  const work = await mkdtemp(join(tmpdir(), 'drashti-bake-words-'));
  try {
    const deck = join(work, 'Placeholder deck.pptx');
    await writeFile(deck, makeTestPptx([{ text: 'Placeholder words', color: '204060', animated: true }]));
    const read = await readPptxDeck(deck);
    const logged: string[] = [];
    // The file gone by the time the stand-in reads it: an error thrown as its movie is made.
    const result = await bakeDeck(
      'stand-in',
      { source: 'pptx', input: join(work, 'Placeholder gone.pptx'), read, work },
      { ffmpeg: '', freeBytes: () => 1024 ** 4, log: (line) => logged.push(line) },
    );
    expect(result).toMatchObject({ ok: false, why: { kind: 'app', reason: 'an error stopped it' } });
    expect(JSON.stringify(result.ok ? null : result.why)).not.toContain('ENOENT');
    expect(logged.filter((line) => line.includes('ENOENT'))).toHaveLength(1);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

/** A movie's cut: each step's offset from its moment (null: nothing seen to move), on `slides` slides. */
function cutOf(
  offsets: [slide: number, step: number, offsetMs: number | null][],
  more: { slides: number; offSlides?: number[]; lostSlides?: number[]; lengthOff?: boolean },
): CutPlan {
  const measured = offsets.flatMap(([slide, step, offsetMs]) =>
    offsetMs === null ? [] : [{ slide, step, offsetMs }],
  );
  return {
    slides: Array.from({ length: more.slides }, (_, index) => ({ index, steps: [] })),
    offsets: offsets.map(([slide, step, offsetMs]) => ({ slide, step, offsetMs })),
    lostSlides: more.lostSlides ?? [],
    offSlides: more.offSlides ?? [],
    lengthOff: more.lengthOff ?? false,
    lengths: { movieMs: 10_000, plannedMs: 10_000 },
    worst: measured.reduce<CutPlan['worst']>(
      (worst, o) => (!worst || Math.abs(o.offsetMs) > Math.abs(worst.offsetMs) ? o : worst),
      null,
    ),
  };
}

it('names the furthest step from its moment, and the furthest of those kept', () => {
  expect(
    stepsCheckedLine(
      cutOf(
        [
          [0, 1, 40],
          [1, 1, -120],
          [1, 2, null],
        ],
        { slides: 2 },
      ),
    ),
  ).toBe(
    'Deck: 3 steps checked, the furthest -120 ms (slide 2, step 1), every one kept; slides not found: none',
  );
  // The second slide's step came 350 ms late: that slide comes in as its picture, its steps not kept.
  expect(
    stepsCheckedLine(
      cutOf(
        [
          [0, 1, 40],
          [1, 1, 350],
          [2, 1, -90],
        ],
        { slides: 3, offSlides: [1], lostSlides: [2] },
      ),
    ),
  ).toBe(
    'Deck: 3 steps checked, the furthest 350 ms (slide 2, step 1), the furthest kept -90 ms (slide 3, step 1); slides not found: 3',
  );
  // Off its plan: no step is kept, the deck comes in as its pictures.
  expect(stepsCheckedLine(cutOf([[0, 1, 40]], { slides: 1, lengthOff: true }))).toBe(
    'Deck: 1 steps checked, the furthest 40 ms (slide 1, step 1), none kept (off its plan); slides not found: none',
  );
  expect(stepsCheckedLine(cutOf([[0, 1, null]], { slides: 1 }))).toBe(
    'Deck: 1 steps checked, the furthest not measured, every one kept; slides not found: none',
  );
});
