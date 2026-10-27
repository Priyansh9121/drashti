import { expect, type Locator, type Page, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeckSlide } from '../../src/shared/deck';
import type { MediaElement } from '../../src/shared/model';
import { makeDeckMedia, makeTestDeck, TRIAL_SLIDES } from '../../src/main/import/testing/make-deck';
import { expectNoSeriousA11yIssues } from './a11y';
import { dropFiles, launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A PowerPoint deck imported "with its animations" (Session 54, C2). CI has no Office: a stand-in makes the
 * deck's movie as PowerPoint makes its timed copy's (DRASHTI_TEST_DECK_BAKER=1), and Drashti cuts it for real.
 * The deck is C1's placeholder trial deck (assister/session-54-deck-trial.md), made here with FFmpeg's media:
 * six slides, the last hidden, a different transition on each, clicks, a chain, a spin, two videos and a sound.
 * Then the same deck where nothing makes its movie (pictures, as before, with its videos as real videos), and on
 * a computer with neither PowerPoint nor Keynote. In CI's window, 1024 × 645; each report passes axe.
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

/**
 * The deck's line under one heading of the import report. An import with notes is listed under "Imported with
 * notes", and again under "Imported", as the report lists every one: the deck imported once has one line under each.
 */
function lineUnder(report: Locator, heading: RegExp): Locator {
  return report
    .getByTestId('report-section')
    .filter({ has: report.page().locator('summary', { hasText: heading }) })
    .getByTestId('report-item')
    .filter({ hasText: DECK });
}
const WITH_NOTES = /Imported with notes \(\d+\)/u;
const IMPORTED = /Imported \(\d+\)/u;

/** Drop the deck on the library and wait for the import's report. */
async function importDeck(win: Page, deck: string) {
  await openLibrary(win);
  await dropFiles(win, win.getByTestId('library-drop'), [deck]);
  const report = win.getByTestId('import-report');
  await expect(report).toBeVisible({ timeout: 150_000 });
  return report;
}

test('a deck comes in with its animations: each slide its steps, its one picture, its videos and sounds real media, and the report says which app and how long', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_TEST_DECK_BAKER: '1', DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const mediaBefore = (await listMedia(win)).length;
  const report = await importDeck(win, trialDeck());
  // Imported once: one line under "Imported with notes", and that one again under "Imported".
  const item = lineUnder(report, WITH_NOTES);
  await expect(item).toHaveAttribute('data-outcome', 'imported');
  await expect(lineUnder(report, IMPORTED)).toHaveCount(1);
  await expect(item).toContainText(
    /The stand-in made this deck’s movie with its animations in \d+ s: 5 slides with 8 clicks\./u,
  );
  await expect(item).toContainText('Next and Back step through the clicks as in its slide show');
  await expect(item).toContainText('Every step was found where it should be in the movie');
  await expect(item).toContainText('Its 2 videos and sound came in as real media');
  await expect(item).toContainText('1 transition sound plays as its slide comes in.');
  await expect(item).toContainText('1 slide is hidden in the file and left out, as in its slide show.');
  await expectNoSeriousA11yIssues(
    win,
    'the report of a deck with its animations',
    '[data-testid="import-report"]',
  );

  const slides = await deckSlides(win);
  // Its five shown slides, with their notes; the hidden one left out.
  expect(slides.map((s) => s.notes)).toEqual(TRIAL_SLIDES.filter((s) => !s.hidden).map((s) => s.notes));
  const decks: (DeckSlide | undefined)[] = slides.map((s) => s.slide.deck);
  // Step 0 coming in, then one per click.
  expect(decks.map((d) => d?.steps.length)).toEqual([5, 3, 2, 1, 2]);
  expect(decks.map((d) => d?.transition?.name)).toEqual([
    'p:fade',
    'p:push',
    'p:wipe',
    'p:cover',
    'p14:vortex',
  ]);
  // ONE picture each, its last step's last frame; the deck's videos as videos on their slides, at their boxes.
  for (const [i, s] of slides.entries()) {
    expect(s.slide.elements[0]).toMatchObject({ kind: 'image', mediaId: decks[i]?.steps.at(-1)?.lastId });
  }
  const videos = slides.map((s) => s.slide.elements.filter((e): e is MediaElement => e.kind === 'video'));
  expect(videos.map((v) => v.length)).toEqual([0, 0, 0, 1, 1]);
  expect(videos[3]?.[0]).toMatchObject({ loop: true, volume: 0.8, fit: 'stretch' });
  expect(decks[3]?.media[0]).toMatchObject({
    kind: 'video',
    mediaId: videos[3]?.[0]?.mediaId,
    clip: { startMs: 1000, endMs: 4000 },
    loop: true,
    start: { step: 0 },
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

test('where nothing makes its movie, a deck comes in as pictures with its videos as real videos on their slides and its sound as the slide’s, said plainly', async () => {
  test.setTimeout(180_000);
  // The stand-in saves it as PDF, as PowerPoint would; nothing makes its movie.
  const { app } = await launchApp({ DRASHTI_TEST_DECK_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const report = await importDeck(win, trialDeck());
  // Imported once: one line under "Imported with notes", and that one again under "Imported".
  const item = lineUnder(report, WITH_NOTES);
  await expect(item).toHaveAttribute('data-outcome', 'imported');
  await expect(lineUnder(report, IMPORTED)).toHaveCount(1);
  await expect(item).toContainText('Each of the 5 pages became a slide holding its picture');
  await expect(item).toContainText(
    'Its 2 videos came in as real videos where the slides have them, with the time bar under LIVE; they start as their slide goes up.',
  );
  await expect(item).toContainText('1 sound plays as its slide goes up.');
  await expectNoSeriousA11yIssues(win, 'the report of a deck as pictures', '[data-testid="import-report"]');
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

test('on a computer with neither PowerPoint nor Keynote, a deck’s videos and sound still come in as media, and the report says what needs one', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const report = await importDeck(win, trialDeck());
  const item = report.getByTestId('report-item').filter({ hasText: DECK });
  await expect(item).toHaveAttribute('data-outcome', 'failed');
  await expect(item).toContainText('no Keynote or PowerPoint');
  await expect(item).toContainText(
    'Its 3 videos and sounds came in as media (in the Media list), with the time bar. Its slides as pictures, and its animations, clicks and transitions, need PowerPoint (or Keynote on a Mac)',
  );
  await expectNoSeriousA11yIssues(
    win,
    'the report of a deck with no app here',
    '[data-testid="import-report"]',
  );
  await expect
    .poll(async () => (await listMedia(win)).map((m) => m.name).sort())
    .toEqual(expect.arrayContaining(['Clip one.mp4', 'Clip two.mp4', 'Tone.m4a']));
  await app.close();
});
