import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import { makeTestDeck, placeholderDeckMedia, TRIAL_SLIDES } from '../testing/make-deck';
import type { BakedDeck } from './bake';
import type { CutFiles, CutPlan } from './cut';
import { bakedPresentation } from './deck-import';
import { plannedLength, powerPointPlan } from './plan';

/*
 * A deck decided slide by slide (Session 54, C review): a slide whose steps came off their moments in the movie (an
 * animated picture moving all the time there, say) comes in as its picture, its videos where they sit, while every
 * other slide keeps its steps; the slide after it is still made after its last still. The movie's files are
 * placeholders here: what is cut is cut.test.ts's.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-off-slides-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('a deck decided slide by slide', () => {
  it('a slide off its moments comes in as its picture; the others keep their steps', async () => {
    const deckFile = join(dir, 'Placeholder trial.pptx');
    writeFileSync(deckFile, makeTestDeck(TRIAL_SLIDES, placeholderDeckMedia()));
    const deck = await readPptxDeck(deckFile);
    const plan = powerPointPlan(deck.slides);
    const work = join(dir, 'work');
    mkdirSync(work, { recursive: true });
    const files: CutFiles[][] = plan.slides.map((s, i) =>
      s.steps.map((_, k) => {
        const clip = join(work, `clip-${String(i)}-${String(k)}.mp4`);
        const last = join(work, `last-${String(i)}-${String(k)}.png`);
        writeFileSync(clip, `placeholder clip ${String(i)} ${String(k)}`);
        writeFileSync(last, `placeholder still ${String(i)} ${String(k)}`);
        return { clip, clipMs: 500, last, hold: null };
      }),
    );
    const cuts: CutPlan = {
      slides: plan.slides.map((s) => ({
        index: s.index,
        steps: s.steps.map((_, k) => ({
          fromMs: 0,
          toMs: 500,
          hold: null,
          transitionMs: k === 0 ? s.transitionMs : 0,
        })),
      })),
      offsets: [
        { slide: 0, step: 1, offsetMs: 40 },
        { slide: 1, step: 1, offsetMs: 450 },
      ],
      lostSlides: [],
      offSlides: [1],
      lengthOff: false,
      lengths: { movieMs: plannedLength(plan), plannedMs: plannedLength(plan) },
      worst: { slide: 1, step: 1, offsetMs: 450 },
    };
    const baked: BakedDeck = {
      baker: 'powerpoint',
      deckFile,
      deck,
      plan,
      cuts,
      files,
      bakeMs: 12_000,
      movie: { width: 1920, height: 1080, fps: 30, durationMs: plannedLength(plan) },
      keynoteMedia: [],
    };
    const parsed = await bakedPresentation('Placeholder trial.pptx', deckFile, baked, work, null, dir);
    const slides = parsed.groups[0]?.slides ?? [];
    expect(slides.map((s) => Boolean(s.deck))).toEqual([true, false, true, true, true]);
    // Its picture: its last step's last still, the only file of its own that comes in.
    const off = slides[1];
    expect(off?.elements).toMatchObject([
      { kind: 'image', frame: { x: 0, y: 0, width: 1920, height: 1080 } },
    ]);
    const picture = off?.elements[0]?.kind === 'image' ? off.elements[0].mediaId : '';
    expect(parsed.media.filter((m) => m.sourcePath?.includes('#slide=2')).map((m) => m.sourcePath)).toEqual([
      `${deckFile}#slide=2&last`,
    ]);
    // The slide after it was made after that still.
    expect(slides[2]?.deck?.after).toBe(picture);
    expect(parsed.issues.find((i) => i.code === 'deck-slides-pictures')?.message).toBe(
      'Slide 2 came in as its picture, without its animations: a step came 0.45 s from its moment in the movie (more than 0.2 s), so it could not be cut exactly. Something there may move all the time (an animated picture).',
    );
    // The steps found where they should be, on the slides cut into steps.
    expect(parsed.issues.find((i) => i.code === 'deck-steps-checked')?.message).toBe(
      'Every step was found where it should be in the movie, the furthest 0.04 s from its moment.',
    );
  });
});
