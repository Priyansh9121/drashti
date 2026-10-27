import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readPptxDeck } from '../pictures';
import {
  DECK_HEIGHT,
  DECK_WIDTH,
  makeTestDeck,
  placeholderDeckMedia,
  TRIAL_SLIDES,
  twentySlides,
} from '../testing/make-deck';
import { readZipEntries } from '../zip';
import { keynotePlan, plannedLength, powerPointPlan } from './plan';
import { stepOfGroup, stepsOf } from './pptx-deck';
import { usingTimings, writeTimedCopy } from './timed-copy';

/*
 * A deck shown as it was (Session 54, C2): C1's trial deck (assister/session-54-deck-trial.md) read from its own
 * XML, against what the trial wrote down of it (its trial.steps.json and the timed copy's schedule, which
 * PowerPoint 16.97 played to within 1–2 frames), and its timed copy: the click groups as one chain, the advance
 * times, the media and transition sounds out, everything else as it was.
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const media = placeholderDeckMedia();
const trial = join(dir, 'Placeholder trial.pptx');
writeFileSync(trial, makeTestDeck(TRIAL_SLIDES, media));

const group = (
  byClick: boolean,
  lengthMs: number,
  extra: { mediaOnly?: boolean; repeatsMs?: number } = {},
) => ({
  byClick,
  lengthMs,
  mediaOnly: extra.mediaOnly ?? false,
  repeatsMs: extra.repeatsMs ?? null,
  untilClickMs: null,
});

describe('reading a deck’s slides, as C1’s trial wrote them down', () => {
  it('reads the slides, hidden or not, their notes and their size', async () => {
    const deck = await readPptxDeck(trial);
    expect(deck.size).toEqual({ cx: DECK_WIDTH, cy: DECK_HEIGHT });
    expect(deck.slides.map((s) => s.hidden)).toEqual([false, false, false, false, false, true]);
    expect(deck.slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.map((s) => s.notes));
  });

  it('reads each transition, its length (p14’s, not its fallback’s) and its sound', async () => {
    const deck = await readPptxDeck(trial);
    expect(deck.slides.map((s) => [s.deck?.transition?.name, s.deck?.transition?.durationMs])).toEqual([
      ['p:fade', 700],
      ['p:push', 1000],
      ['p:wipe', 800],
      ['p:cover', 1000],
      ['p14:vortex', 1500],
      ['p:split', 600],
    ]);
    const sound = deck.slides[1]?.deck?.transition?.sound;
    expect(sound?.part).toMatch(/^ppt\/media\/media\d+\.wav$/u);
    expect(sound?.loop).toBe(false);
    expect(deck.slides.filter((s) => s.deck?.transition?.sound).length).toBe(1);
    expect(deck.slides.every((s) => s.deck?.transition?.advanceMs === null)).toBe(true);
  });

  it('reads the main sequence’s click groups and how long each runs, videos’ and sounds’ starts aside', async () => {
    const deck = await readPptxDeck(trial);
    expect(deck.slides.map((s) => s.deck?.groups)).toEqual([
      // Three bullets one click at a time, then the exit on a fourth.
      [group(true, 500), group(true, 500), group(true, 500), group(true, 500)],
      // A caption by itself (0.3 s in, 0.6 s); a motion path (2 s); A, then B 0.25 s after it, then C.
      [group(false, 900), group(true, 2000), group(true, 1750)],
      // A spin repeating until the slide ends (one turn, 2 s), then a line on a click.
      [group(false, 2000, { repeatsMs: 2000 }), group(true, 700)],
      // Only the video's start.
      [group(false, 0, { mediaOnly: true })],
      // The sound by itself, the video on a click.
      [group(false, 0, { mediaOnly: true }), group(true, 0, { mediaOnly: true })],
      [],
    ]);
    // Step 0 comes with the slide, then one step per click.
    expect(deck.slides.map((s) => stepsOf(s.deck?.groups ?? []))).toEqual([5, 3, 2, 1, 2, 1]);
    const chain = deck.slides[1]?.deck?.groups ?? [];
    expect([0, 1, 2].map((g) => stepOfGroup(chain, g))).toEqual([0, 1, 2]);
  });

  it('reads the videos and the sound: their file, place, poster, trims (end cut from the end), volume, loop and start', async () => {
    const deck = await readPptxDeck(trial);
    expect(deck.slides.map((s) => s.deck?.media.length)).toEqual([0, 0, 0, 1, 2, 0]);
    const [auto] = deck.slides[3]?.deck?.media ?? [];
    expect(auto).toMatchObject({
      kind: 'video',
      name: 'Clip one',
      link: null,
      trim: { startMs: 1000, endMs: 1000 },
      fadeInMs: 0,
      volume: 0.8,
      muted: false,
      loop: true,
      start: { group: 0, offsetMs: 0 },
      acrossSlides: null,
      hideWhenStopped: false,
    });
    expect(auto?.part).toMatch(/^ppt\/media\/media\d+\.mp4$/u);
    expect(auto?.poster).toMatch(/^ppt\/media\/image\d+\.png$/u);
    // 2.4 in from the left of a 13.33 in slide, 8.53 in wide; 1.5 in down a 7.5 in slide, 4.8 in tall.
    expect(auto?.box.x).toBeCloseTo(2.4 / 13.3333, 3);
    expect(auto?.box.w).toBeCloseTo(8.53 / 13.3333, 3);
    expect(auto?.box.y).toBeCloseTo(1.5 / 7.5, 3);
    expect(auto?.box.h).toBeCloseTo(4.8 / 7.5, 3);
    const [video, sound] = deck.slides[4]?.deck?.media ?? [];
    expect(video).toMatchObject({
      kind: 'video',
      trim: null,
      fadeInMs: 500,
      volume: 0.5,
      loop: false,
      start: { group: 1, offsetMs: 0 },
    });
    expect(sound).toMatchObject({
      kind: 'audio',
      volume: 1,
      loop: false,
      start: { group: 0, offsetMs: 0 },
      // numSld="1": its own slide only.
      acrossSlides: null,
      hideWhenStopped: false,
    });
    expect(sound?.part).toMatch(/\.m4a$/u);
  });
});

describe('the movie’s plan', () => {
  it('chains PowerPoint’s timed copy as the trial did: each click 0.4 s after the group before, 0.8 s at the end', async () => {
    const plan = powerPointPlan((await readPptxDeck(trial)).slides);
    expect(plan.settleMs).toBe(60);
    // The hidden slide is no movie's.
    expect(plan.slides.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.slides.map((s) => [s.transitionName, s.transitionMs])).toEqual([
      ['p:fade', 700],
      ['p:push', 1000],
      ['p:wipe', 800],
      ['p:cover', 1000],
      ['p14:vortex', 1500],
    ]);
    const groups = (i: number) => plan.slides[i]?.groups.map((g) => [g.startMs, g.endMs]);
    // As C1's schedule (trial.bake.pptx.schedule.json), which PowerPoint played to plan.
    expect(groups(0)).toEqual([
      [400, 900],
      [1300, 1800],
      [2200, 2700],
      [3100, 3600],
    ]);
    expect(groups(1)).toEqual([
      [0, 900],
      [1300, 3300],
      [3700, 5450],
    ]);
    expect(groups(3)).toEqual([[0, 0]]);
    expect(groups(4)).toEqual([
      [0, 0],
      [400, 400],
    ]);
    expect(plan.slides.map((s) => s.advanceMs)).toEqual([4400, 6250, 10100, 800, 1200]);
    // The spin: the click waits one turn more, so a one-turn hold is cut from the stillness around it; it turns
    // until the last step's hold is cut (7.3 s), in whole turns, then the slide is still before the next.
    expect(plan.slides.map((s) => s.endlessUntilMs)).toEqual([null, null, 7300, null, null]);
    expect(groups(2)).toEqual([
      [0, 2000],
      [4500, 5200],
    ]);
    expect(plan.slides[2]?.steps).toEqual([
      { byClick: false, startMs: 0, endMs: 2000, holdMs: 2000, still: false },
      { byClick: true, startMs: 4500, endMs: 5200, holdMs: 2000, still: false },
    ]);
    // Step 0 of a slide whose first group waits for a click is the transition alone.
    expect(plan.slides[0]?.steps[0]).toEqual({
      byClick: false,
      startMs: 0,
      endMs: 0,
      holdMs: null,
      still: true,
    });
    expect(plan.slides[4]?.steps.map((s) => s.still)).toEqual([true, true]);
  });

  it('plans Keynote’s own movie by its rule: each click 2.0 s after the build before ends, the next slide 5.0 s after the last', async () => {
    const plan = keynotePlan((await readPptxDeck(trial)).slides);
    expect(plan.settleMs).toBe(0);
    // No transition into the first slide.
    expect(plan.slides.map((s) => s.transitionMs)).toEqual([0, 1000, 800, 1000, 1500]);
    const groups = (i: number) => plan.slides[i]?.groups.map((g) => [g.startMs, g.endMs]);
    // The trial's Keynote movie: clicks at 2.07, 4.6, 7.1 and 9.57 s, the next slide at 15.03 s.
    expect(groups(0)).toEqual([
      [2000, 2500],
      [4500, 5000],
      [7000, 7500],
      [9500, 10000],
    ]);
    expect(plan.slides[0]?.advanceMs).toBe(15000);
    expect(groups(1)).toEqual([
      [0, 900],
      [2900, 4900],
      [6900, 8650],
    ]);
    // Builds that only started a video or sound are gone from its movie (Drashti deleted those first).
    expect(groups(4)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(plan.slides.map((s) => s.advanceMs)).toEqual([15000, 13650, 9700, 5000, 5000]);
    expect(plan.slides.every((s) => s.steps.every((st) => st.holdMs === null))).toBe(true);
  });

  it('reads when a video comes in by its entrance and leaves by its exit, as steps', async () => {
    const [, , , video] = TRIAL_SLIDES;
    if (!video) throw new Error('no trial slide');
    const enters = join(dir, 'Placeholder video enters.pptx');
    writeFileSync(
      enters,
      makeTestDeck(
        [
          {
            ...video,
            effects: [
              { kind: 'fade', target: 3, dur: 500, start: 'click' },
              { kind: 'play', target: 3, dur: 3000, start: 'after' },
              { kind: 'exit-fade', target: 3, dur: 500, start: 'click' },
            ],
          },
        ],
        media,
      ),
    );
    const deck = await readPptxDeck(enters);
    const [m] = deck.slides[0]?.deck?.media ?? [];
    expect([m?.enterGroup, m?.exitGroup]).toEqual([0, 1]);
    expect([
      stepOfGroup(deck.slides[0]?.deck?.groups ?? [], 0),
      stepOfGroup(deck.slides[0]?.deck?.groups ?? [], 1),
    ]).toEqual([1, 2]);
    // The trial's own videos have neither: shown from the slide's start to its end.
    const trialDeck = await readPptxDeck(trial);
    expect(trialDeck.slides[3]?.deck?.media.map((x) => [x.enterGroup, x.exitGroup])).toEqual([[null, null]]);
  });

  it('a spin repeating until the next click turns through its own step only: a hold after it, none after the click', async () => {
    const [, , loop] = TRIAL_SLIDES;
    if (!loop) throw new Error('no trial slide');
    const untilClick = join(dir, 'Placeholder until click.pptx');
    writeFileSync(
      untilClick,
      makeTestDeck(
        [
          {
            ...loop,
            effects: [
              {
                kind: 'spin',
                target: 3,
                dur: 2000,
                start: 'with',
                repeat: 'indefinite',
                untilNextClick: true,
              },
              { kind: 'fade', target: 4, dur: 700, start: 'click' },
            ],
          },
        ],
        media,
      ),
    );
    const deck = await readPptxDeck(untilClick);
    expect(deck.slides[0]?.deck?.groups.map((g) => [g.repeatsMs, g.untilClickMs])).toEqual([
      [null, 2000],
      [null, null],
    ]);
    const plan = powerPointPlan(deck.slides);
    // One turn held after step 0, as before; it turns until that hold is cut (4.1 s), in whole turns, and the click
    // comes only once it has stopped, as the click stops it in the show; no hold after the click.
    expect(plan.slides[0]?.steps.map((s) => s.holdMs)).toEqual([2000, null]);
    expect(plan.slides[0]?.groups).toEqual([
      { startMs: 0, endMs: 2000, untilMs: 4100 },
      { startMs: 6500, endMs: 7200 },
    ]);
    expect(plan.slides[0]?.advanceMs).toBe(8000);
    // The copy turns it whole turns until its hold is cut (4.1 s: three turns), then it stops.
    const copy = join(dir, 'Placeholder until click timed.pptx');
    await writeTimedCopy(untilClick, copy, plan);
    const xml = (await readZipEntries(copy, (n) => n === 'ppt/slides/slide1.xml')).get(
      'ppt/slides/slide1.xml',
    );
    expect(xml?.toString('utf8')).toContain('repeatCount="3000"');
  });

  it('plans the 20-slide deck’s movie at about the trial’s length (88 s), a turn longer for each spin', async () => {
    const twenty = join(dir, 'Placeholder twenty.pptx');
    writeFileSync(twenty, makeTestDeck(twentySlides(), media));
    const plan = powerPointPlan((await readPptxDeck(twenty)).slides);
    expect(plan.slides).toHaveLength(20);
    // 87.4 s as the trial planned it, and 6.2 s more for each of the four spinning slides' holds and stillness.
    expect(plannedLength(plan)).toBe(87_400 + 4 * 6_200);
  });
});

describe('the timed copy', () => {
  it('chains each slide’s clicks from its start, moves on by itself, and leaves its videos and sounds still', async () => {
    const plan = powerPointPlan((await readPptxDeck(trial)).slides);
    const copy = join(dir, 'Placeholder timed.pptx');
    await writeTimedCopy(trial, copy, plan);
    const timed = await readPptxDeck(copy);
    // One group each, beginning with the slide: the whole chain, its last effect where the plan ends.
    expect(timed.slides.map((s) => s.deck?.groups)).toEqual([
      [group(false, 3600)],
      [group(false, 5450)],
      // The spin turns four times (8 s), past the last hold's end, then stops.
      [group(false, 8000)],
      [],
      [],
      [],
    ]);
    // It moves on by itself; the hidden slide is as it was.
    expect(timed.slides.map((s) => s.deck?.transition?.advanceMs)).toEqual([
      4400,
      6250,
      10100,
      800,
      1200,
      null,
    ]);
    // Transition sounds out; transitions themselves kept, p14's included.
    expect(timed.slides.map((s) => s.deck?.transition?.sound ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(timed.slides.map((s) => s.deck?.transition?.name)).toEqual([
      'p:fade',
      'p:push',
      'p:wipe',
      'p:cover',
      'p14:vortex',
      'p:split',
    ]);
    // The videos and the sound keep their place and poster, but nothing starts them, and they do not loop.
    const kept = timed.slides.flatMap((s) => s.deck?.media ?? []);
    expect(kept.map((m) => [m.kind, m.start, m.loop])).toEqual([
      ['video', { clicked: true }, false],
      ['video', { clicked: true }, false],
      ['audio', { clicked: true }, false],
    ]);
    // Notes, and every other part, as they were.
    expect(timed.slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.map((s) => s.notes));
    const others = (file: string) =>
      readZipEntries(file, (name) => !name.startsWith('ppt/slides/slide'), 64 * 1024 * 1024);
    const [was, now] = await Promise.all([others(trial), others(copy)]);
    expect([...now.keys()].sort()).toEqual([...was.keys()].sort());
    for (const [name, bytes] of was) expect(now.get(name)?.equals(bytes), name).toBe(true);
  });

  it('uses the slides’ timings where the deck’s slide show was set not to', () => {
    expect(
      usingTimings(
        '<p:presentationPr><p:showPr loop="1" useTimings="0" showNarration="1"/></p:presentationPr>',
      ),
    ).toBe('<p:presentationPr><p:showPr loop="1" showNarration="1"/></p:presentationPr>');
    const using = '<p:showPr useTimings="1"><p:present/></p:showPr>';
    expect(usingTimings(using)).toBe(using);
  });

  it('keeps each slide’s words and shapes byte for byte: only its timing and transition change', async () => {
    const plan = powerPointPlan((await readPptxDeck(trial)).slides);
    const copy = join(dir, 'Placeholder timed again.pptx');
    await writeTimedCopy(trial, copy, plan);
    const slide = (file: string) =>
      readZipEntries(file, (name) => name === 'ppt/slides/slide1.xml').then(
        (m) => m.get('ppt/slides/slide1.xml')?.toString('utf8') ?? '',
      );
    const [was, now] = await Promise.all([slide(trial), slide(copy)]);
    const tree = (xml: string) => /<p:cSld>[\s\S]*<\/p:cSld>/u.exec(xml)?.[0];
    expect(tree(now)).toBe(tree(was));
    expect(now).toContain('advTm="4400"');
    expect(now).not.toContain('clickEffect');
    expect(now).toContain('evt="onBegin"');
  });
});
