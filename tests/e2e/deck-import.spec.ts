import { expect, type Page, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DeckSlide, stepCount } from '../../src/shared/deck';
import type { MediaElement } from '../../src/shared/model';
import { makeDeckMedia, makeTestDeck, TRIAL_SLIDES } from '../../src/main/import/testing/make-deck';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropFiles, launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { importItem } from './import-details';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A PowerPoint deck imported "with its animations" (Session 54, C2). CI has no Office: a stand-in makes the
 * deck's movie as PowerPoint makes its timed copy's (DRASHTI_TEST_DECK_BAKER=1), and Drashti cuts it for real.
 * The deck is C1's placeholder trial deck (assister/session-54-deck-trial.md), made here with FFmpeg's media:
 * six slides, the last hidden, a different transition on each, clicks, a chain, a spin, two videos and a sound.
 * The same deck also exercises the picture fallback while on air and native playback on a computer without
 * Office. The tests use CI's 1024 × 645 operator window.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const DECK = 'Placeholder trial deck';

/** The trial deck, its media made by FFmpeg, in a folder of its own. */
function trialDeck(): string {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-deck-e2e-'));
  const deck = join(dir, `${DECK}.pptx`);
  writeFileSync(deck, makeTestDeck(TRIAL_SLIDES, makeDeckMedia(ffmpeg ?? '', join(dir, 'made'))));
  return deck;
}

/** The deck's slides as the library has them. */
async function deckSlides(win: Page) {
  return win.evaluate(async (name) => {
    const d = (globalThis as PageGlobals).drashti;
    const found = (await d.library.listPresentations()).find((p) => p.name === name);
    const doc = found ? await d.library.getPresentation(found.id) : null;
    return (doc?.groups ?? []).flatMap((g) =>
      g.slides.map((s) => ({ notes: s.notes, slide: s.slide, cues: s.cues })),
    );
  }, DECK);
}

const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());

/** Drop the deck on the library and read its completed import details. */
async function importDeck(win: Page, deck: string) {
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('library-drop'), [deck]);
  await expect.poll(() => importItem(win, deck), { timeout: 150_000 }).not.toBeNull();
  await expect(win.getByTestId('import-report')).toHaveCount(0);
  return importItem(win, deck);
}

test('a mixed deck keeps its click steps, uses native playback where supported, and keeps its videos and sounds', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_TEST_DECK_BAKER: '1', DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const mediaBefore = (await listMedia(win)).length;
  const item = await importDeck(win, trialDeck());
  expect(item?.outcome).toBe('imported');
  const notes = item?.issues.map((issue) => issue.message).join(' ') ?? '';
  // The stand-in records the same details that PowerPoint does.
  expect(notes).toMatch(
    /PowerPoint made this deck’s movie with its animations in \d+ s: 5 slides with 8 clicks\./u,
  );
  expect(notes).not.toContain('stand-in');
  expect(notes).toContain('Next and Back step through the clicks as in its slide show');
  expect(notes).toContain('Every step was found where it should be in the movie');
  expect(notes).toContain('Its 2 videos and sound came in as real media');
  expect(notes).toContain('1 transition sound plays as its slide comes in.');
  const notice = win.getByTestId('import-notice').filter({ hasText: DECK });
  await expect(notice).toContainText('1 slide is hidden in the file and left out, as in its slide show.');
  await expectNoSeriousA11yIssues(win, 'the animated deck import notice', '[data-testid="import-notice"]');

  const slides = await deckSlides(win);
  // Its five shown slides, with their notes; the hidden one left out.
  expect(slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.filter((s) => !s.hidden).map((s) => s.notes));
  const decks: (DeckSlide | undefined)[] = slides.map((s) => s.slide.deck);
  // The supported fourth slide plays its own transition and video without a baked clip.
  expect(decks.map(stepCount)).toEqual([5, 3, 2, 1, 2]);
  expect(decks.map((d) => d?.steps.length)).toEqual([5, 3, 2, 0, 2]);
  expect(decks[3]?.motion).toMatchObject({ approximate: false, stepsMs: [0] });
  expect(decks.map((d) => d?.transition?.name)).toEqual([
    'p:fade',
    'p:push',
    'p:wipe',
    'p:push',
    'p14:vortex',
  ]);
  // The baked slides draw their last frame. The native slide keeps the editable title.
  for (const i of [0, 1, 2, 4]) {
    expect(slides[i]?.slide.elements[0]).toMatchObject({
      kind: 'image',
      mediaId: decks[i]?.steps.at(-1)?.lastId,
    });
  }
  expect(slides[3]?.slide.elements).toContainEqual(
    expect.objectContaining({ kind: 'text', text: 'Moving tessel plays by itself' }),
  );
  expect(decks[3]?.sourceStillId).toBeTruthy();
  expect(decks[4]?.after).toBe(decks[3]?.sourceStillId);
  const videos = slides.map((s) => s.slide.elements.filter((e): e is MediaElement => e.kind === 'video'));
  expect(videos.map((v) => v.length)).toEqual([0, 0, 0, 1, 1]);
  expect(videos[3]?.[0]).toMatchObject({ loop: true, volume: 0.8, fit: 'stretch' });
  expect(decks[3]?.media[0]).toMatchObject({
    kind: 'video',
    mediaId: videos[3]?.[0]?.mediaId,
    clip: { startMs: 1000, endMs: 4000 },
    loop: true,
    start: { step: 0, offsetMs: 0 },
  });
  expect(decks[4]?.media.map((m) => [m.kind, 'step' in m.start ? m.start.step : 'clicked'])).toEqual([
    ['video', 1],
    ['audio', 0],
  ]);
  // The spin's slide holds one turn after each step.
  expect(decks[2]?.steps.map((s) => s.holdMs)).toEqual([2000, 2000]);
  // Its clips, pictures, videos and sounds are the deck's: out of the Media list, as a deck's pages are.
  expect((await listMedia(win)).length).toBe(mediaBefore);
  await app.close();
});

test('a mixed deck imported while on air uses pictures and keeps its videos and automatic sound', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_TEST_DECK_BAKER: '1',
    DRASHTI_TEST_DECK_CONVERTER: '1',
    DRASHTI_TEST_ON_AIR_HOOK: '1',
  });
  // Set the import worker's on-air flag without starting a stream.
  await app.evaluate(() => {
    const onAir = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
    if (!onAir) throw new Error('The on-air test hook is missing.');
    onAir(true);
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const item = await importDeck(win, trialDeck());
  expect(item?.outcome).toBe('imported');
  const notes = item?.issues.map((issue) => issue.message).join(' ') ?? '';
  expect(notes).toContain('Each of the 5 pages became a slide holding its picture');
  expect(notes).toContain(
    'Its 2 videos came in as real videos where the slides have them, with the time bar under LIVE; they start as their slide goes up.',
  );
  expect(notes).toContain('1 sound plays as its slide goes up.');
  await expectNoSeriousA11yIssues(win, 'the deck imported as pictures');
  const slides = await deckSlides(win);
  expect(slides).toHaveLength(5);
  expect(slides.every((s) => !s.slide.deck)).toBe(true);
  expect(slides.map((s) => s.slide.elements.map((e) => e.kind))).toEqual([
    ['image'],
    ['image'],
    ['image'],
    ['image', 'video'],
    ['image', 'video'],
  ]);
  expect(slides[4]?.cues.map((c) => c.kind)).toEqual(['audio']);
  await app.close();
});

test('without Office, a deck imports with native clicks, real media and warnings for approximated effects', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const mediaBefore = (await listMedia(win)).length;
  const item = await importDeck(win, trialDeck());
  expect(item?.outcome).toBe('imported');
  const notice = win.getByTestId('import-notice').filter({ hasText: DECK });
  for (const index of [1, 2, 3, 5])
    await expect(notice).toContainText(`Slide ${index} uses the closest effects Drashti can play.`);
  await expectNoSeriousA11yIssues(win, 'the approximated effects notice', '[data-testid="import-notice"]');
  const slides = await deckSlides(win);
  const decks = slides.map((s) => s.slide.deck);
  expect(decks.map(stepCount)).toEqual([5, 3, 2, 1, 2]);
  expect(decks.map((d) => d?.steps.length)).toEqual([0, 0, 0, 0, 0]);
  expect(decks.map((d) => d?.motion?.approximate)).toEqual([true, true, true, false, true]);
  expect(decks[3]?.media[0]).toMatchObject({
    kind: 'video',
    clip: { startMs: 1000, endMs: 4000 },
    start: { step: 0, offsetMs: 0 },
  });
  expect(decks[4]?.media.map((m) => [m.kind, 'step' in m.start ? m.start.step : 'clicked'])).toEqual([
    ['video', 1],
    ['audio', 0],
  ]);
  expect((await listMedia(win)).length).toBe(mediaBefore);
  await app.close();
});
