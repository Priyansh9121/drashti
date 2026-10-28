import { describe, expect, it } from 'vitest';
import type { CutPlan } from './cut';
import { bakedIssues, noAppIssue, picturesMediaIssues, took, whyPictures } from './deck-import';

/*
 * What the import report says of a deck (Session 54, C2): which app made its animations and how long it took, what
 * came across and what did not, why a deck came in as pictures instead, and on a computer with neither PowerPoint
 * nor Keynote, plainly, what needs one.
 */

const DECK = {
  baker: 'powerpoint' as const,
  bakeMs: 17_400,
  slides: 20,
  clicks: 32,
  worstMs: 49,
  hidden: 1,
  withNotes: 20,
  videos: 4,
  audios: 4,
  clicked: 0,
  across: 0,
  acrossTriggered: 0,
  transitionSounds: 4,
  advancing: 0,
  trimmed: 4,
  triggers: 0,
};

/** A cut of five slides, `offSlides` off their moments, its movie `movieMs` long where 60 s were planned. */
const cuts = (offSlides: number[], movieMs = 60_000): CutPlan => ({
  slides: [0, 1, 2, 3, 4].map((index) => ({ index, steps: [] })),
  offsets: [],
  lostSlides: [],
  offSlides,
  lengthOff: Math.abs(movieMs - 60_000) > 3000,
  lengths: { movieMs, plannedMs: 60_000 },
  worst: null,
});

describe('the report’s words on a deck', () => {
  it('says which app made its animations, how long it took, and how far its steps were from their moments', () => {
    const words = bakedIssues(DECK).map((i) => i.message);
    expect(words).toEqual([
      'PowerPoint made this deck’s movie with its animations in 17 s: 20 slides with 32 clicks. Next and Back step through the clicks as in its slide show, then on to the next slide; each slide’s own transition plays as it comes in.',
      'Every step was found where it should be in the movie, the furthest 0.05 s from its moment.',
      'Its 4 videos and 4 sounds came in as real media, played as the deck plays them (when they start, trims, loop and volume), with the time bar under LIVE.',
      '4 transition sounds play as its slide comes in.',
      '1 slide is hidden in the file and left out, as in its slide show.',
      '20 slides have speaker notes, kept as the slide’s notes (the stage screen shows them).',
    ]);
    expect(took(17_400)).toBe('17 s');
    expect(took(65_000)).toBe('1 min 5 s');
  });

  it('says what did not come across: a trigger’s effects, media started by a click on it, a deck moving on by itself, Keynote’s trims', () => {
    const words = bakedIssues({
      ...DECK,
      baker: 'keynote',
      clicked: 1,
      triggers: 2,
      advancing: 3,
      hidden: 0,
      withNotes: 0,
      transitionSounds: 0,
      worstMs: null,
    }).map((i) => i.message);
    expect(words).toContain(
      'Keynote does not tell a video’s trims: a video trimmed in Keynote plays whole here. Its start and end points can be set in Media (Markers).',
    );
    expect(words).toContain(
      '1 video or sound starts only when clicked on in the deck: in Drashti, start it with Play on the time bar under LIVE.',
    );
    expect(words).toContain(
      '2 effects ran only when a shape was clicked, which Next never does: they are left out.',
    );
    expect(words).toContain(
      '3 slides moved on by themselves after some seconds in the deck: in Drashti each waits for Next (a Repeat Slides playlist moves on by itself).',
    );
    expect(words).toContain(
      'Its 4 videos and 4 sounds came in as real media, played as the deck plays them (when they start, trims, loop and volume), with the time bar under LIVE.',
    );
    expect(words).toContain('The file has no speaker notes.');
    // Nothing could be seen to move: nothing is said of the steps' moments.
    expect(words.some((w) => w.startsWith('Every step was found'))).toBe(false);
  });

  it('says that its sounds set to play across slides play on, and that one only a click on it starts stays on its slide (Session 54)', () => {
    const words = (across: number, acrossTriggered: number) =>
      bakedIssues({ ...DECK, across, acrossTriggered })
        .filter((i) => i.code.startsWith('deck-across'))
        .map((i) => i.message);
    expect(words(1, 0)).toEqual([
      '1 sound set to play across slides plays on as the slides and their clicks change, as in its slide show, until its last slide; Next and Back never start it again.',
    ]);
    expect(words(2, 2)).toEqual([
      '2 sounds set to play across slides play on as the slides and their clicks change, as in its slide show, each until its last slide; Next and Back never start one again.',
      '2 sounds set to play across slides start only when clicked on: here they play on their own slides, from Play on the time bar under LIVE.',
    ]);
    expect(words(0, 0)).toEqual([]);
    // As pictures: its slide's sound saying so, and a slide's own sound where it plays on taking its place.
    expect(
      picturesMediaIssues({ videos: 0, cued: 2, left: 0, across: 1, overMusic: [3, 7] }).map(
        (i) => i.message,
      ),
    ).toEqual([
      '2 sounds play as their slide goes up.',
      '1 sound set to play across slides plays on from its slide, as in its slide show, until its last slide; Next and Back never start it again.',
      'The sounds of slides 3 and 7 take the place of the sound playing across slides as those slides go up: as pictures, one sound plays at a time (with the deck’s animations, both play).',
    ]);
  });

  it('says plainly why a deck came in as pictures', () => {
    expect(whyPictures({ kind: 'on-air' }, 'powerpoint')).toEqual({
      severity: 'warning',
      code: 'deck-pictures',
      message:
        'The stream was on air, so Drashti did not make this deck’s animations (that would slow the stream): its slides came in as pictures, without their animations. Import it again once the stream is off air.',
      fix: null,
    });
    expect(whyPictures({ kind: 'off-plan', cuts: cuts([0, 2, 4]) }, 'powerpoint').message).toBe(
      'PowerPoint made the deck’s movie, but steps on 3 of its 5 slides came more than 0.2 s from their moments, so its clicks could not be cut exactly: its slides came in as pictures, without their animations.',
    );
    expect(whyPictures({ kind: 'off-plan', cuts: cuts([], 100_000) }, 'powerpoint').message).toBe(
      'PowerPoint made the deck’s movie, but it was 1 min 40 s long where 1 min 0 s were planned (it did not use the deck’s timings), so its clicks could not be cut exactly: its slides came in as pictures, without their animations.',
    );
    expect(
      whyPictures({ kind: 'app', reason: 'PowerPoint stopped answering', message: '' }, 'powerpoint').message,
    ).toBe(
      'PowerPoint could not make the deck’s movie (PowerPoint stopped answering): its slides came in as pictures, without their animations.',
    );
    expect(whyPictures({ kind: 'cut', detail: 'FFmpeg could not cut the movie' }, 'powerpoint').message).toBe(
      'PowerPoint made the deck’s movie, but it could not be cut into its steps (FFmpeg could not cut the movie): its slides came in as pictures, without their animations.',
    );
  });

  it('says what came in beside the pictures, and on a computer with neither app what needs one', () => {
    expect(picturesMediaIssues({ videos: 1, cued: 1, left: 2 }).map((i) => i.message)).toEqual([
      'Its video came in as a real video where its slide has it, with the time bar under LIVE; it starts as its slide goes up.',
      '1 sound plays as its slide goes up.',
      '2 sounds that started on a click, or with a transition, are left out: they need the deck’s animations, which PowerPoint or Keynote makes.',
    ]);
    expect(picturesMediaIssues({ videos: 0, cued: 0, left: 0 })).toEqual([]);
    // Its pictures not one a slide: nothing to put its videos and sounds on.
    expect(picturesMediaIssues({ videos: 0, cued: 0, left: 0, unmatched: 3 }).map((i) => i.message)).toEqual([
      'Its 3 videos and sounds were left out: its pictures could not be matched to its slides one for one (some pages could not be drawn, or the PDF has a different number of pages than it has slides shown).',
    ]);
    expect(noAppIssue({ media: 0 }).message).toBe(
      'Its slides as pictures, and its animations, clicks and transitions, need PowerPoint (or Keynote on a Mac): import it on a computer with one, or save it as PDF there and import the PDF here.',
    );
  });
});
