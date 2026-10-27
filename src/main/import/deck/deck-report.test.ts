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
  acrossCued: 0,
  acrossLater: 0,
  acrossSecond: 0,
  transitionSounds: 4,
  advancing: 0,
  trimmed: 4,
  triggers: 0,
};

const cuts = (worst: CutPlan['worst'], lostSlides: number[] = []): CutPlan => ({
  slides: [],
  offsets: [],
  lostSlides,
  worst,
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

  it('says plainly why a deck came in as pictures', () => {
    expect(whyPictures({ kind: 'on-air' }, 'powerpoint')).toEqual({
      severity: 'warning',
      code: 'deck-pictures',
      message:
        'The stream was on air, so Drashti did not make this deck’s animations (that would slow the stream): its slides came in as pictures, without their animations. Import it again once the stream is off air.',
      fix: null,
    });
    expect(
      whyPictures({ kind: 'off-plan', cuts: cuts({ slide: 2, step: 1, offsetMs: -450 }) }, 'powerpoint')
        .message,
    ).toBe(
      'PowerPoint made the deck’s movie, but a step on slide 3 came 0.45 s from its moment (more than 0.2 s), so its clicks could not be cut exactly: its slides came in as pictures, without their animations.',
    );
    expect(whyPictures({ kind: 'off-plan', cuts: cuts(null, [4]) }, 'keynote').message).toBe(
      'Keynote made the deck’s movie, but slide 5 was not where it should be in it, so its clicks could not be cut exactly: its slides came in as pictures, without their animations.',
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
    expect(noAppIssue({ media: 0 }).message).toBe(
      'Its slides as pictures, and its animations, clicks and transitions, need PowerPoint (or Keynote on a Mac): import it on a computer with one, or save it as PDF there and import the PDF here.',
    );
  });
});
