import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { DeckSlide } from '../../src/shared/deck';
import { IPC } from '../../src/shared/ipc';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  CLIP_MS,
  deckSound,
  deckVideo,
  ffmpeg,
  HOLD_COLOUR,
  makeDeckFiles,
  NEXT_COLOURS,
  STEP_COLOURS,
  standInDecks,
  TRANSITION_MS,
  writeDeck,
} from './deck-stand-in';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  killApp,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  outputReady,
  relaunchApp,
  savedLive,
  setUpScreen,
  sizeSlideEditor,
  slideEditorWindow,
  testDisplays,
  windowShowing,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { canvasPixels, near, pixels } from './pixels';
import { holdClock } from './placeholder-slides';

/*
 * A deck shown as it was (Session 54, C2), from a stand-in made in the test (deck-stand-in.ts: FFmpeg's flat colours
 * as each step's clip and last frame, written into the library as C2's import stores a deck), so no Office and no
 * import is needed. Next and Back go through the clicks with the keys and a phone; every screen draws each step from
 * the engine's time: two of the hall's screens, a node, key and fill, LIVE, the stage's current and next and the
 * phone, compared at moments the engine's clock is held at. A hold goes round; Drashti's own transition comes instead
 * of the deck's; a deck's video starts at its click with the time bar; its sound plays in step. Quiet, generated media
 * only, displays no wider than 1024.
 */

const MIDDLE = { x: 960, y: 540 };

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
const dispatch = (win: Page, command: Record<string, unknown>) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);
const step = async (win: Page) => (await state(win)).layers.slide?.step ?? null;
const stepAt = async (win: Page) => (await state(win)).layers.slide?.stepAt ?? 0;

/** The output showing a screen, ready to draw the show. */
async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  await outputReady(found);
  return found;
}

/**
 * A deck's clip loaded ahead, before the press (Session 57, item 6): its first frame in (loaded 2 or more) and paused,
 * then marked, so a check after the press can tell the very element plays (nothing loaded anew at the press).
 */
async function markPrepared(clip: Locator): Promise<void> {
  await expect
    .poll(() => clip.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(clip).toHaveJSProperty('paused', true);
  await clip.evaluate((video) => {
    video.setAttribute('data-deck-check-prepared', 'true');
  });
}

/** Wait until each output's middle is this colour. */
async function allShow(outs: Page[], rgb: readonly number[], what: string): Promise<void> {
  for (const out of outs)
    await expect
      .poll(
        async () => near((await canvasPixels(out, [MIDDLE]))[0], [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0]),
        {
          message: what,
          timeout: 15_000,
        },
      )
      .toBe(true);
}

/** Tests only (C review): LIVE's clock in the operator window held with the screens', or let go (null). */
const holdLive = (app: ElectronApplication, at: number | null) =>
  app.evaluate(
    (_e, at) =>
      (globalThis as { drashtiTestHoldLive?: (at: number | null) => boolean }).drashtiTestHoldLive?.(at) ??
      false,
    at,
  );

/**
 * The colours at points of a page, and the colour `rgb` as that page draws it, read from the one picture (C review): a
 * small swatch of it, in the page's top left corner for that picture only. A window colour-managed to its display (the
 * operator window on a Mac's own screen draws sRGB green 0,96,0 as about 39,94,23 on Display P3; a phone's page) is
 * then compared with its own drawing of the colour, never with the sRGB numbers, as on CI's sRGB screens.
 */
async function withSwatch(
  page: Page,
  rgb: readonly number[],
  points: { x: number; y: number }[],
): Promise<{ colours: number[][]; swatch: [number, number, number] }> {
  await page.evaluate(
    (rgb) => {
      const swatch = document.createElement('div');
      swatch.id = 'deck-check-swatch';
      Object.assign(swatch.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: '8px',
        height: '8px',
        zIndex: '2147483647',
        pointerEvents: 'none',
        background: `rgb(${rgb.join(',')})`,
      });
      document.body.append(swatch);
    },
    [...rgb],
  );
  try {
    const read = await pixels(page, [...points, { x: 4, y: 4 }]);
    const s = read[points.length] ?? [];
    return { colours: read.slice(0, points.length), swatch: [s[0] ?? -999, s[1] ?? -999, s[2] ?? -999] };
  } finally {
    await page.evaluate(() => {
      document.getElementById('deck-check-swatch')?.remove();
    });
  }
}

/**
 * Wait until the middle of an element on its page (LIVE's picture, a stage box, a phone's picture) is this colour, as
 * that page draws it (withSwatch). When it is not, the failure says what was there (C review): the colour against the
 * swatch's, the page's visibility, the deck's step's phase, and each of its layers with its opacity (a clip or hold
 * also its time, how far it has loaded, and whether it plays), so a failed run says why.
 */
async function middleShows(page: Page, target: Locator, rgb: readonly number[], what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        if (!box) return 'no box';
        const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const {
          colours: [colour],
          swatch,
        } = await withSwatch(page, rgb, [middle]);
        if (near(colour, swatch)) return 'shows';
        const there = await target.evaluate((el) => {
          const root = el.querySelector<HTMLElement>('[data-deck-step]') ?? el;
          const layers = [...root.children].map((child) => {
            // A slide's first clip is in a box of its own (DeckStep.tsx's FirstClip): the clip.
            const inner = child.hasAttribute('data-deck-slot') ? child.firstElementChild : null;
            const c = (inner ?? child) as HTMLElement;
            const role = c.dataset['deckStill'] ?? c.dataset['deckVideo'] ?? c.tagName.toLowerCase();
            const opacity = getComputedStyle(c).opacity;
            return c instanceof HTMLVideoElement
              ? `${role} ${opacity} at ${c.currentTime.toFixed(2)} s, loaded ${String(c.readyState)}${c.paused ? ', paused' : ''}`
              : `${role} ${opacity}`;
          });
          return `page ${document.visibilityState}, step ${root.dataset['deckPhase'] ?? 'none'}: ${layers.join(' | ')}`;
        });
        return `${(colour ?? []).join(',')} against the swatch's ${swatch.join(',')} (${there})`;
      },
      { message: `${what}: what was there`, timeout: 15_000 },
    )
    .toBe('shows');
}

/** Hold every app's clock at `ms` after the step up was shown, and wait for each output to show `rgb`. */
async function heldAt(
  apps: ElectronApplication[],
  win: Page,
  outs: Page[],
  ms: number,
  rgb: readonly number[],
) {
  const at = await stepAt(win);
  for (const app of apps) await holdClock(app, at + ms);
  await allShow(outs, rgb, `${String(ms)} ms into the step`);
}

test('a deck’s clicks with the keys: Next and Back, two screens and LIVE drawing each step from the engine’s time, the stage’s current and next, a hold going round', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const id = await writeDeck(win, 'Placeholder deck', standInDecks(files));
    const one = await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
    const two = await outputFor(app, await setUpScreen(win, 'Side Hall', 1));
    const stageScreen = await setUpScreen(win, 'Stage', 2);
    await win.evaluate(async (screenId) => {
      const d = (globalThis as PageGlobals).drashti;
      const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
      const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
      if (!set.ok) throw new Error(set.message);
    }, stageScreen);
    const stage = await outputFor(app, stageScreen);
    const halls = [one, two];

    // Chosen in the library, as an operator chooses it: the keys work on what the slide grid shows (Drashti chooses the
    // library's first presentation by itself, a placeholder, so Next would put that up), and Next puts it up.
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder deck' })
      .click();
    await expect(win.getByTestId('slide-grid').getByRole('heading', { level: 2 })).toBeVisible();
    await closeLibrary(win);
    await win.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(win)).live.presentationId).toBe(id);
    // Come to by a jump: its coming-in clip past the deck's own transition; then held at its last frame, red.
    expect((await state(win)).layers.slide).toMatchObject({ step: 0, stepFromMs: TRANSITION_MS });
    await allShow(halls, STEP_COLOURS[0].last, 'the first step’s last frame');
    for (const out of halls)
      await expect(out.locator('[data-deck-step="0"]')).toHaveAttribute('data-deck-phase', 'held');

    // On the spot (Session 57, item 6): the next click's clip has its first frame in, paused, before the key is
    // pressed, in the step itself (the outputs' Preloader does not load it a second time); Next plays that very element.
    for (const out of halls) {
      await markPrepared(out.locator('video[data-deck-video="preparing"]'));
      const twice = out.getByTestId('preload').locator(`[data-preload="${files.clips[1] ?? ''}"]`);
      await expect(twice).toHaveCount(0);
    }
    // Next with the key: the first click, on both screens, LIVE and the stage; the stage's next is the click after.
    await win.keyboard.press('ArrowRight');
    await expect.poll(() => step(win)).toBe(1);
    for (const out of halls)
      await expect(out.locator('[data-deck-step="1"] video[data-deck-video="clip"]')).toHaveAttribute(
        'data-deck-check-prepared',
        'true',
      );
    // LIVE says which click is up.
    await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2 · click 1 of 2');
    // At held moments (C review): the hall's screens and the stage's current play the click's clip (dark), then hold
    // its last frame (bright), each at the same moment. LIVE's picture is compared in a test of its own, where no
    // screen's window covers the operator window (here they do: a window covered draws no frames).
    const stageNow = stage.locator('[data-stage-deck="now"]');
    for (const [ms, colour] of [
      [300, STEP_COLOURS[1].clip],
      [CLIP_MS + 800, STEP_COLOURS[1].last],
    ] as const) {
      await heldAt([app], win, halls, ms, colour);
      await middleShows(stage, stageNow, colour, `the stage’s current, ${String(ms)} ms into the click`);
    }
    await holdClock(app, null);
    await middleShows(
      stage,
      stage.locator('[data-stage-deck="next"]'),
      STEP_COLOURS[2].last,
      'the stage’s next: the next click’s last frame',
    );
    await expect(win.getByTestId('live-preview').locator('[data-deck-step="1"]')).toBeVisible();
    await expect(stage.locator('[data-stage-deck="now"] [data-deck-step="1"]')).toHaveCount(1);
    await expect(
      stage.locator(
        `[data-stage-deck="next"] [data-deck-next="2"] img[data-media-id="${files.lasts[2] ?? ''}"]`,
      ),
    ).toHaveCount(1);

    // The last click: its clip, then its hold going round (magenta) while it waits.
    await win.keyboard.press('ArrowRight');
    await expect.poll(() => step(win)).toBe(2);
    await heldAt([app], win, halls, 300, STEP_COLOURS[2].clip);
    await holdClock(app, null);
    for (const out of halls)
      await expect(out.locator('[data-deck-step="2"]')).toHaveAttribute('data-deck-phase', 'hold');
    await allShow(halls, HOLD_COLOUR, 'the hold going round');
    // What comes next is the next slide coming in: its first step's last frame on the stage.
    await expect(
      stage.locator(`[data-stage-deck="next"] img[data-media-id="${files.nextLast}"]`),
    ).toHaveCount(1);

    // Back with the key: the click before at its last frame at once, no motion (still).
    await win.keyboard.press('ArrowLeft');
    await expect.poll(() => step(win)).toBe(1);
    for (const out of halls)
      await expect(out.locator('[data-deck-step="1"]')).toHaveAttribute('data-deck-still', 'true');
    await allShow(halls, STEP_COLOURS[1].last, 'Back: the click before at its last frame');

    // Next twice: the next slide comes in order, the deck's own transition in its clip from its start.
    await win.keyboard.press('ArrowRight');
    await expect(stage.locator('[data-stage-deck="now"] [data-deck-step="2"]')).toHaveCount(1);
    // Its first clip loaded and decoded ahead by each hall's Preloader before the key is pressed; as the slide comes
    // in, its step plays that very element (Session 57, item 6).
    for (const out of halls)
      await markPrepared(out.getByTestId('preload').locator(`video[data-preload="${files.nextClip}"]`));
    await win.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
    for (const out of halls)
      await expect(
        out.locator(`[data-deck-step="0"] video[data-deck-video="clip"][data-media-id="${files.nextClip}"]`),
      ).toHaveAttribute('data-deck-check-prepared', 'true');
    // The stage keeps the still that showed before under the new slide's clip until it can be drawn (C review).
    await expect(
      stage.locator(
        `[data-stage-deck="now"] [data-deck-still="under"][data-media-id="${files.lasts[2] ?? ''}"]`,
      ),
    ).toHaveCount(1);
    expect((await state(win)).layers.slide).toMatchObject({ step: 0 });
    expect((await state(win)).layers.slide?.stepFromMs).toBeUndefined();
    await allShow(halls, NEXT_COLOURS.last, 'the next slide’s last frame');
    // Back from its first step: the slide before at its last step.
    await win.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(0);
    expect(await step(win)).toBe(2);
  } finally {
    await app.close();
  }
});

test('LIVE draws a deck’s click from the engine’s time as the screens do: at held moments its clip, then its last frame (C review)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  // No screen set up: nothing covers the operator window, so LIVE draws every frame (a window under the screens'
  // windows draws none).
  const { app } = await launchApp({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const id = await writeDeck(win, 'Placeholder LIVE deck', standInDecks(files));
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await dispatch(win, { type: 'next' });
    const live = win.getByTestId('live-preview').getByTestId('scene').first();
    await expect(live.locator('[data-deck-step="1"]')).toHaveCount(1);
    const clickAt = await stepAt(win);
    for (const [ms, colour, phase] of [
      [300, STEP_COLOURS[1].clip, 'clip'],
      [CLIP_MS + 800, STEP_COLOURS[1].last, 'held'],
    ] as const) {
      // The test switch reaches the operator window, and LIVE draws that moment. A clip's time is not compared: under
      // a held clock, a playing video plays on until it is a quarter of a second from the clock, then is aimed back
      // with its lead (render/playback.ts), on every screen alike, so it reads from the held moment to about half a
      // second past it (0.46 s at 300 ms, in a run); its colour is the step's throughout.
      expect(await holdLive(app, clickAt + ms), 'LIVE’s clock held').toBe(true);
      await expect(live.locator('[data-deck-step="1"]')).toHaveAttribute('data-deck-phase', phase);
      await middleShows(win, live, colour, `LIVE, ${String(ms)} ms into the click`);
    }
    await holdLive(app, null);
  } finally {
    await app.close();
  }
});

test('a slide left unticked never shows through the next slide’s own transition: at that slide’s first moments the one before shows, never it (C review)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const step = (clipId: string, lastId: string) => ({
      clipId,
      clipMs: CLIP_MS,
      transitionMs: TRANSITION_MS,
      lastId,
    });
    const own = { name: 'fade', durationMs: TRANSITION_MS };
    // Red, then green (left unticked), then the last slide, whose coming-in clip begins on the green slide's last frame
    // (as a deck's movie is cut), then turns yellow.
    const decks: DeckSlide[] = [
      { transition: own, steps: [step(files.clips[0] ?? '', files.lasts[0] ?? '')], media: [] },
      {
        transition: own,
        after: files.lasts[0],
        steps: [step(files.clips[1] ?? '', files.lasts[1] ?? '')],
        media: [],
      },
      { transition: own, after: files.lasts[1], steps: [step(files.through, files.nextLast)], media: [] },
    ];
    const id = await writeDeck(win, 'Placeholder unticked deck', decks, {
      unticked: [1],
      transition: { kind: 'dissolve', durationMs: 1000 },
    });
    const out = await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await allShow([out], STEP_COLOURS[0].last, 'the first slide’s last frame');
    // Held before the next slide comes on, so it waits at its very start; Next skips the unticked slide.
    await holdClock(app, Date.now() - 60_000);
    await dispatch(win, { type: 'next' });
    const layer = (await state(win)).layers.slide;
    // Not made after the slide before it in the order played: past its own transition, under the presentation's.
    expect(layer).toMatchObject({
      slideIndex: 1,
      step: 0,
      stepFromMs: TRANSITION_MS,
      transition: { kind: 'dissolve', durationMs: 1000 },
    });
    const shownAt = layer?.shownAt ?? 0;
    await holdClock(app, shownAt);
    await allShow([out], STEP_COLOURS[0].last, 'its first moment: the slide before, whole');
    for (const ms of [0, 150, 300]) {
      await holdClock(app, shownAt + ms);
      const [middle] = await canvasPixels(out, [MIDDLE]);
      expect(near(middle, [32, 224, 32], 60), `${String(ms)} ms in: the unticked slide’s green`).toBe(false);
    }
    await holdClock(app, null);
  } finally {
    await app.close();
  }
});

test('Drashti’s own transition set in the slide editor at 1024 × 645 comes instead of the deck’s own, and the editor passes axe', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.setViewportSize({ width: 1024, height: 645 });
    const files = await makeDeckFiles(win);
    const id = await writeDeck(win, 'Placeholder transitions deck', standInDecks(files));
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder transitions deck' })
      .click();
    await win.getByTestId('edit-slides').click();
    // The editor's own window (Session 55, Part 17a), at CI's size.
    const { ed, editor } = await slideEditorWindow(app);
    await sizeSlideEditor(app, ed, { width: 1024, height: 645 });
    // The second slide: the deck's own named, then Fade instead of it, 0.6 s.
    await editor.getByTestId('editor-slide-thumb').nth(1).click();
    const transitions = editor.getByTestId('deck-transitions');
    await expect(transitions.getByTestId('deck-own-transition')).toContainText('Fade, 0.4 s');
    await transitions.getByTestId('deck-transition').selectOption('dissolve');
    await expect(transitions.getByTestId('deck-transition-mode')).toHaveValue('instead');
    await transitions.getByTestId('deck-transition-seconds').fill('0.6');
    // The first slide's second click: Slide, over its own motion.
    await editor.getByTestId('editor-slide-thumb').nth(0).click();
    await transitions.getByTestId('deck-step-transition-2').selectOption('slide');
    await transitions.getByTestId('deck-step-transition-2-mode').selectOption('over');
    // Everything inside the window at CI's size.
    const box = await transitions.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(1024);
    await expectNoSeriousA11yIssues(ed, 'a deck’s transitions in the slide editor at 1024 × 645');
    await editor.getByTestId('save-slides').click();

    // Kept with the deck's slide: in order, the next slide comes on with Drashti's Fade instead of the deck's own.
    const saved = () =>
      win.evaluate(async (id) => {
        const opened = await (globalThis as PageGlobals).drashti.library.slidesForEdit(id);
        if (!opened.ok) throw new Error(opened.message);
        return opened.doc.groups
          .flatMap((g) => g.slides)
          .map((s) => ({ drashti: s.deck?.drashti ?? null, steps: s.deck?.stepTransitions ?? null }));
      }, id);
    await expect
      .poll(async () => (await saved())[1]?.drashti)
      .toEqual({ transition: { kind: 'dissolve', durationMs: 600 }, mode: 'instead' });
    expect((await saved())[0]?.steps).toEqual({
      2: { transition: { kind: 'slide', durationMs: 800 }, mode: 'over' },
    });
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    for (let i = 0; i < 3; i++) await dispatch(win, { type: 'next' });
    expect((await state(win)).layers.slide).toMatchObject({
      step: 0,
      stepFromMs: TRANSITION_MS,
      transition: { kind: 'dissolve', durationMs: 600 },
    });
  } finally {
    await app.close();
  }
});

test('a deck’s video starts at its click with the time bar under LIVE, and its sound plays in step on Drashti’s audio', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const decks = standInDecks(files, {
      first: {
        media: [deckVideo(files, { step: 1, offsetMs: 0 }), deckSound(files, { step: 0, offsetMs: 0 })],
      },
    });
    const id = await writeDeck(win, 'Placeholder media deck', decks);
    const out = await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    // Before its click: waiting under its poster, and its bar paused.
    const video = out.locator(`video[data-media-id="${files.video}"]`);
    await expect(video).toHaveAttribute('data-deck-cover', 'poster');
    await expect(out.locator(`[data-deck-poster="${files.poster}"]`)).toHaveCount(1);
    const bar = win.locator(`[data-testid="time-bar-row"][data-playing="slide:${files.video}"]`);
    await expect(bar).toHaveAttribute('data-paused', 'true');
    // Its click: it plays on the screen from then, its bar playing too.
    await dispatch(win, { type: 'next' });
    const clickAt = await stepAt(win);
    await expect(video).toHaveAttribute('data-deck-cover', 'none');
    await expect(bar).not.toHaveAttribute('data-paused', 'true');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.2))
      .toBe(true);
    const offset = await video.evaluate(
      (v: HTMLVideoElement, at) => v.currentTime - (Date.now() - at) / 1000,
      clickAt,
    );
    expect(Math.abs(offset)).toBeLessThan(0.25);
    // Its sound (with the slide) in the audio player, in step with the engine's time.
    await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
    const audio = app.windows().find((w) => w.url().includes('audio.html'));
    if (!audio) throw new Error('no audio player');
    const shownAt = (await state(win)).layers.slide?.shownAt ?? 0;
    await expect
      .poll(() =>
        audio.evaluate(
          ({ mediaId, shownAt }) => {
            const a = document.querySelector<HTMLAudioElement>(`audio[data-media-id="${mediaId}"]`);
            if (!a || a.paused || !Number.isFinite(a.duration)) return null;
            const expected = ((Date.now() - shownAt) / 1000) % a.duration;
            return Math.abs(a.currentTime - expected) < 0.3;
          },
          { mediaId: files.tone, shownAt },
        ),
      )
      .toBe(true);
    // The time bar names it a sound on the slide.
    await expect(
      win.locator(`[data-testid="time-bar-row"][data-playing="slide:${files.tone}"]`),
    ).toHaveAttribute('aria-label', 'Time of the sound on the slide');
  } finally {
    await app.close();
  }
});

test('a deck’s video shows only between its entrance and its exit: hidden before and after, never its poster, and in place once its entrance’s motion is over (C review)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    // It comes in at the first click (and starts then), and goes at the second.
    const entering = { ...deckVideo(files, { step: 1, offsetMs: 0 }), enterStep: 1, exitStep: 2 };
    const id = await writeDeck(
      win,
      'Placeholder entering deck',
      standInDecks(files, { first: { media: [entering] } }),
    );
    const out = await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
    const video = out.locator(`video[data-media-id="${files.video}"]`);
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await expect(video).toHaveAttribute('data-deck-cover', 'hidden');
    await expect(out.locator(`[data-deck-poster="${files.poster}"]`)).toHaveCount(0);
    // Its entrance: hidden while the click's clip brings its poster in, in place once that is over.
    await dispatch(win, { type: 'next' });
    const at = await stepAt(win);
    await holdClock(app, at + 300);
    await expect(video).toHaveAttribute('data-deck-cover', 'hidden');
    await holdClock(app, at + CLIP_MS + 100);
    await expect(video).toHaveAttribute('data-deck-cover', 'none');
    await expect(video).toBeVisible();
    await holdClock(app, null);
    // Its exit: hidden from the click that takes it away; come back to by Back, in place at once.
    await dispatch(win, { type: 'next' });
    await expect(video).toHaveAttribute('data-deck-cover', 'hidden');
    await dispatch(win, { type: 'previous' });
    expect(await step(win)).toBe(1);
    await expect(video).toHaveAttribute('data-deck-cover', 'none');
  } finally {
    await app.close();
  }
});

test('after an unexpected restart a deck’s slide comes back on the same click, where it would be by now, and Next goes on from there (C review)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const env = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
  const first = await launchApp(env);
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const files = await makeDeckFiles(win);
  const id = await writeDeck(win, 'Placeholder restart deck', standInDecks(files));
  await setUpScreen(win, 'Main Hall', 0);
  await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
  await dispatch(win, { type: 'next' });
  await dispatch(win, { type: 'next' });
  const was = (await state(win)).layers.slide;
  expect(was?.step).toBe(2);
  // Saved as it changes: once the file has the click, Drashti is stopped dead.
  await savedLive(first.userData, (saved) => (saved.slide as { step?: number } | null)?.step === 2);
  await killApp(first.app);
  const second = await relaunchApp(first.userData, env);
  try {
    const win2 = await operatorPage(second.app);
    await operatorReady(win2);
    // The same click, from when it was shown: its clip long over, its hold going round.
    expect((await state(win2)).layers.slide).toMatchObject({
      presentationId: id,
      step: 2,
      shownAt: was?.shownAt,
      stepAt: was?.stepAt,
    });
    const out = await outputPage(second.app);
    await outputReady(out);
    await expect(out.locator('[data-deck-step="2"]')).toHaveAttribute('data-deck-phase', 'hold');
    await allShow([out], HOLD_COLOUR, 'the click’s hold, where it would be by now');
    // Next goes on from that click: the next slide.
    await dispatch(win2, { type: 'next' });
    await expect.poll(async () => (await state(win2)).live.slideIndex).toBe(1);
  } finally {
    await second.app.close();
  }
});

test('a phone steps through a deck’s clicks with Next and Back, its live picture showing the step, and passes axe', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  const phone = await device('chromium');
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const id = await writeDeck(win, 'Placeholder phone deck', standInDecks(files));
    await setUpScreen(win, 'Main Hall', 0);
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const p = phone.page;
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-next-button').click();
    await expect.poll(() => step(win)).toBe(1);
    await expect(p.getByTestId('remote-live').locator('[data-deck-step="1"]')).toHaveCount(1);
    // Once its clip is over, its last frame's preview.
    await expect(p.getByTestId('remote-live').locator('[data-deck-step="1"]')).toHaveAttribute(
      'data-deck-phase',
      'held',
      {
        timeout: CLIP_MS * 4,
      },
    );
    // Its picture (C review): the click's last frame, as the hall's screens hold it (a phone's clock is its own, not
    // held: it is read once the step has settled).
    await middleShows(
      p,
      p.getByTestId('remote-live').locator('[data-deck-step="1"]'),
      STEP_COLOURS[1].last,
      'the phone’s live picture: the click’s last frame',
    );
    await p.getByTestId('remote-next-button').click();
    await expect.poll(() => step(win)).toBe(2);
    await p.getByTestId('remote-back').click();
    await expect.poll(() => step(win)).toBe(1);
    expect((await state(win)).layers.slide?.stepFromMs).toBe(CLIP_MS);
    await p.setViewportSize({ width: 375, height: 812 });
    await expectNoSeriousA11yIssues(p, 'the remote on a phone with a deck’s step up');
  } finally {
    await phone.close();
    await app.close();
  }
});

test('a node and key and fill draw the same step as Main’s screen at held moments of the engine’s time', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(300_000);
  const main = await launchMain({ DRASHTI_TEST_CLOCK_HOLD: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  const node = await launchNode({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  try {
    const nodeId = await pairNode(main, node);
    const files = await makeDeckFiles(main.win);
    const id = await writeDeck(main.win, 'Placeholder node deck', standInDecks(files));
    // Main's own screen, and the node's second display in the same group.
    const screenId = await setUpScreen(main.win, 'Placeholder Hall', 0);
    const groupId = await main.win.evaluate(
      async (n) =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find((g) => g.name === n)?.id ?? '',
      'Placeholder Hall',
    );
    await expect
      .poll(async () =>
        main.win.evaluate(
          async (id) =>
            (
              (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
                ?.displays ?? []
            ).length,
          nodeId,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    const assigned = await main.win.evaluate(
      async ({ groupId, nodeId }) => {
        const d = (globalThis as PageGlobals).drashti;
        const displayId = (await d.screens.get()).nodes.find((n) => n.id === nodeId)?.displays[1]?.id ?? -1;
        return d.screens.assignNodeDisplay(groupId, nodeId, displayId);
      },
      { groupId, nodeId },
    );
    expect(assigned.ok).toBe(true);
    // Key and fill on Main's other two displays.
    const on = (await testDisplays(main.win)).map((x) => x.id).slice(1, 3);
    const pair = await main.win.evaluate(async (on) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.screens.createGroup('Placeholder switcher');
      if (!made.ok) throw new Error(made.message);
      const group = made.snapshot.groups.find((g) => g.name === 'Placeholder switcher');
      const role = await d.screens.setGroupRole(group?.id ?? '', 'keyfill');
      if (!role.ok) throw new Error(role.message);
      for (const id of on) {
        const used = await d.screens.assignDisplay(group?.id ?? '', id, { coverOperator: true });
        if (!used.ok) throw new Error(used.message);
      }
      return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens.map((s) => s.id) ?? [];
    }, on);
    const mainOut = await outputFor(main.app, screenId);
    const fill = await outputFor(main.app, pair[0] ?? '');
    const key = await outputFor(main.app, pair[1] ?? '');
    let nodeOut: Page | undefined;
    await expect.poll(() => (nodeOut = outputPages(node.app)[0]) !== undefined).toBe(true);
    if (!nodeOut) throw new Error('no node output');
    await outputReady(nodeOut);
    // The stream's picture too (C review), as flash-pixels.spec.ts holds it: its page from the Stream panel.
    await main.win.getByTestId('open-stream').click();
    const program = await windowShowing(main.app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(program.getByTestId('program-root')).toBeVisible();
    // The node has every clip and last frame by the time the slide is up (copied ahead).
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await dispatch(main.win, { type: 'next' });
    const apps = [main.app, node.app];
    const screens = [mainOut, nodeOut, fill, program];
    await heldAt(apps, main.win, screens, 300, STEP_COLOURS[1].clip);
    await heldAt(apps, main.win, screens, CLIP_MS + 800, STEP_COLOURS[1].last);
    // The key is white where the fill has the deck's picture: over the whole slide.
    await allShow([key], [255, 255, 255], 'the key white over the deck’s picture');
    for (const app of apps) await holdClock(app, null);
    // The operator points at the second slide's row on Main (C3, Session 58): the node's output loads its first clip
    // ahead as Main's screens do, at the frame a click there starts it from, and lets it go when the pointing goes.
    const pointAt = (slideIndex: number | null) =>
      main.win.evaluate(
        (target) => (globalThis as PageGlobals).drashti.engine.pointAt(target),
        slideIndex === null ? null : { presentationId: id, slideIndex, arrangementId: null },
      );
    const nodeAhead = nodeOut
      .getByTestId('preload')
      .locator(`video[data-preload="${files.nextClip}"][data-deck-ahead="pointed"]`);
    await pointAt(1);
    await expect(nodeAhead).toHaveAttribute('data-state', 'ready');
    expect(await nodeAhead.evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(
      TRANSITION_MS / 1000,
    );
    await pointAt(null);
    await expect(nodeAhead).toHaveCount(0);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

test('a deck’s sound set to play across slides plays on through the clicks and slides with its own time bar, never started again by Next or Back, and stops after its last slide (the owner’s answer of 28 Oct)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    // Across its first two slides of three (PowerPoint's "stop after 2 slides").
    const music = {
      ...deckSound(files, { step: 0, offsetMs: 0 }),
      acrossSlides: 2,
      name: 'Placeholder music',
    };
    const [first, second] = standInDecks(files, { first: { media: [music] } });
    if (!first || !second) throw new Error('no stand-in slides');
    const id = await writeDeck(win, 'Placeholder music deck', [
      first,
      second,
      { ...second, after: files.nextLast },
    ]);
    await outputFor(app, await setUpScreen(win, 'Main Hall', 0));
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    // On the audio layer as the sound playing, with the sound's own bar, never the slide's.
    const sound = async () => (await state(win)).layers.audio;
    await expect.poll(async () => (await sound())?.mediaId).toBe(files.tone);
    const startedAt = (await sound())?.startedAt;
    await expect(win.locator('[data-testid="time-bar-row"][data-playing="audio"]')).toHaveAttribute(
      'aria-label',
      'Time of the sound playing',
    );
    await expect(win.locator(`[data-testid="time-bar-row"][data-playing="slide:${files.tone}"]`)).toHaveCount(
      0,
    );
    // Drashti's audio player plays it.
    await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
    const audio = app.windows().find((w) => w.url().includes('audio.html'));
    if (!audio) throw new Error('no audio player');
    const heard = () =>
      audio.evaluate((mediaId) => {
        const a = document.querySelector<HTMLAudioElement>(`audio[data-media-id="${mediaId}"]`);
        return a !== null && !a.paused;
      }, files.tone);
    await expect.poll(heard).toBe(true);
    const where = async () => {
      const live = (await state(win)).live;
      return `${String(live.slideIndex)}:${String(await step(win))}`;
    };
    // Its first slide's two clicks, then its second slide: the same playing all along.
    for (const at of ['0:1', '0:2', '1:0']) {
      await dispatch(win, { type: 'next' });
      await expect.poll(where).toBe(at);
      expect((await sound())?.startedAt, `at ${at}`).toBe(startedAt);
    }
    // Back onto its first slide, then Next onto the second again: never started again, never stopped.
    await dispatch(win, { type: 'back' });
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(0);
    expect((await sound())?.startedAt, 'after Back').toBe(startedAt);
    await dispatch(win, { type: 'next' });
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
    expect((await sound())?.startedAt, 'after Next again').toBe(startedAt);
    await expect.poll(heard).toBe(true);
    // The third slide is past its last: it stops, its bar goes.
    await dispatch(win, { type: 'next' });
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(2);
    await expect.poll(async () => (await sound()) ?? null).toBeNull();
    await expect(win.locator('[data-testid="time-bar-row"][data-playing="audio"]')).toHaveCount(0);
    await expect.poll(heard).toBe(false);
  } finally {
    await app.close();
  }
});

test('a failed click clip appears when its late copy becomes available', async () => {
  expect(ffmpeg, 'bundled FFmpeg for placeholder clips').not.toBeNull();
  const { app } = await launchApp({
    DRASHTI_TEST_CLOCK_HOLD: '1',
    DRASHTI_WINDOWED_OUTPUTS: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const clipId = files.clips[1];
    if (!clipId) throw new Error('Expected a placeholder click clip');
    const id = await writeDeck(win, 'Placeholder late deck clip', standInDecks(files));
    const out = await outputFor(app, await setUpScreen(win, 'Placeholder Hall', 0));

    // A missing first copy fails for this one clip. On the node's retry URL Chromium decodes the generated video.
    await out.evaluate((mediaId) => {
      const prototype = HTMLMediaElement.prototype;
      const src = Object.getOwnPropertyDescriptor(prototype, 'src');
      if (!src?.set) throw new Error('Expected the Chromium media source setter');
      Object.defineProperty(prototype, 'src', {
        ...src,
        set(this: HTMLMediaElement, value: string) {
          const unavailable = this.dataset['mediaId'] === mediaId && !new URL(value).searchParams.has('try');
          if (unavailable && this.dataset['deckVideo'] === 'preparing') return;
          src.set?.call(this, unavailable ? 'data:video/webm;base64,AA==' : value);
        },
      });
    }, clipId);
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await expect(out.locator('[data-deck-step="0"]')).toHaveAttribute('data-deck-phase', 'held');
    await dispatch(win, { type: 'next' });
    const at = await stepAt(win);
    expect(at).toBeGreaterThan(0);
    expect(await holdClock(app, at + 250)).toBe(1);
    const shown = out.locator('[data-deck-step="1"]');
    const clip = shown.locator('video[data-deck-video="clip"]');
    await expect.poll(() => clip.evaluate((video: HTMLVideoElement) => video.error !== null)).toBe(true);
    await expect(shown).toHaveAttribute('data-deck-phase', 'held');

    await app.evaluate(
      ({ BrowserWindow }, { channel, mediaId }) => {
        const output = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('output.html'),
        );
        if (!output) throw new Error('Expected the output window');
        output.webContents.send(channel, { mediaId });
      },
      { channel: IPC.output.mediaReady, mediaId: clipId },
    );
    await expect(clip).toHaveAttribute('src', /[?]try=1$/);
    await expect
      .poll(() => clip.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect(shown).toHaveAttribute('data-deck-phase', 'clip');
    await holdClock(app, null);
  } finally {
    await app.close();
  }
});

test('a cold direct jump keeps the outgoing slide, plays the full first animation, and catches up on the engine’s time', async () => {
  expect(ffmpeg, 'bundled FFmpeg for placeholder clips').not.toBeNull();
  const { app } = await launchApp({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    // The second slide's first step with a hold going round after it (C3T-3): it starts as late as the clip ends.
    const id = await writeDeck(
      win,
      'Placeholder direct jump',
      standInDecks(files, {
        second: {
          steps: [
            {
              clipId: files.nextClip,
              clipMs: CLIP_MS,
              transitionMs: TRANSITION_MS,
              lastId: files.nextLast,
              holdId: files.hold,
              holdMs: 1000,
            },
          ],
        },
      }),
    );
    const live = win.getByTestId('live-preview').getByTestId('scene').first();
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await expect(live.locator('[data-deck-step="0"]')).toHaveAttribute('data-deck-phase', 'held');

    // Hold just the next slide’s first file until the renderer has advanced its clock. The media is generated and
    // everything else still uses the real decoder and playback. Record the first seek before the video can play.
    await win.evaluate((mediaId) => {
      const proto = HTMLMediaElement.prototype;
      const source = Object.getOwnPropertyDescriptor(proto, 'src');
      const time = Object.getOwnPropertyDescriptor(proto, 'currentTime');
      if (!source?.set || !time?.set) throw new Error('Expected Chromium media setters');
      const firstClip = (node: HTMLMediaElement) =>
        node.dataset['deckVideo'] === 'clip' && node.dataset['mediaId'] === mediaId;
      Object.defineProperty(proto, 'src', {
        ...source,
        set(this: HTMLMediaElement, value: string) {
          if (firstClip(this) && !this.dataset['testColdClip']) {
            this.dataset['testColdClip'] = 'waiting';
            document.addEventListener('release-placeholder-first-clip', () => source.set?.call(this, value), {
              once: true,
            });
          } else source.set?.call(this, value);
        },
      });
      Object.defineProperty(proto, 'currentTime', {
        ...time,
        set(this: HTMLMediaElement, value: number) {
          if (firstClip(this)) this.dataset['testFirstSeek'] ??= String(value);
          time.set?.call(this, value);
        },
      });
    }, files.nextClip);
    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 1 });
    const clip = live.locator('video[data-test-cold-clip="waiting"]');
    await expect(clip).toHaveCount(1);
    await expect(live.locator('[data-slide-out]')).toHaveCSS('opacity', '1');
    const at = await stepAt(win);
    expect(at).toBeGreaterThan(0);
    expect(await holdLive(app, at + 450)).toBe(true);
    await win.evaluate(() => document.dispatchEvent(new Event('release-placeholder-first-clip')));
    await expect(clip).toHaveAttribute('data-test-first-seek', String(TRANSITION_MS / 1000));
    const showing = live.locator('[data-slide-in] [data-deck-step="0"]').last();
    await expect(showing).toHaveAttribute('data-deck-phase', 'clip');
    // From that frame it catches up on the engine's time (C3's review M1): a little faster, never more than a tenth.
    const rate = () => clip.evaluate((video: HTMLVideoElement) => video.playbackRate);
    await expect.poll(rate).toBeGreaterThan(1);
    expect(await rate()).toBeLessThanOrEqual(1.1);
    // 0.45 s late with 1.1 s of the clip to come, a tenth faster makes up 0.1 s: it ends 0.35 s after the engine's
    // time, not 0.45 s (C3T-5: 10 ms either side of it).
    expect(await holdLive(app, at + CLIP_MS - TRANSITION_MS + 340)).toBe(true);
    await expect(showing).toHaveAttribute('data-deck-phase', 'clip');
    expect(await holdLive(app, at + CLIP_MS - TRANSITION_MS + 360)).toBe(true);
    await expect(showing).not.toHaveAttribute('data-deck-phase', 'clip');
    // Its hold then goes round from there, 0.35 s late, and makes that up a little faster, never more than a tenth
    // (C3T-3).
    await expect(showing).toHaveAttribute('data-deck-phase', 'hold');
    const hold = showing.locator('video[data-deck-video="hold"]');
    const holdRate = () => hold.evaluate((video: HTMLVideoElement) => video.playbackRate);
    await expect.poll(holdRate).toBeGreaterThan(1);
    expect(await holdRate()).toBeLessThanOrEqual(1.1);
    await holdLive(app, null);
  } finally {
    await app.close();
  }
});

/** Each frame a page draws from now: the phase of the step drawing `clipId`, once it is there (its first 30). */
async function recordPhases(page: Page, clipId: string): Promise<void> {
  await page.evaluate((clipId) => {
    const seen: string[] = [];
    (globalThis as { deckCheckPhases?: string[] }).deckCheckPhases = seen;
    const until = performance.now() + 20_000;
    const each = () => {
      const clip = document.querySelector(`[data-deck-step] [data-media-id="${clipId}"]`);
      const phase = clip?.closest<HTMLElement>('[data-deck-step]')?.dataset['deckPhase'];
      if (phase !== undefined) seen.push(phase);
      if (performance.now() < until && seen.length < 30) requestAnimationFrame(each);
    };
    requestAnimationFrame(each);
  }, clipId);
}

/** The step drawing the clip played that very element, marked ahead, from the first frame the page drew it. */
async function playedAtOnce(page: Page, clipId: string, what: string): Promise<void> {
  await expect(
    page.locator(`[data-deck-step] video[data-deck-video="clip"][data-media-id="${clipId}"]`),
    `${what}: the element loaded ahead`,
  ).toHaveAttribute('data-deck-check-prepared', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as { deckCheckPhases?: string[] }).deckCheckPhases?.length ?? 0),
    )
    .toBeGreaterThan(3);
  const phases = await page.evaluate(
    () => (globalThis as { deckCheckPhases?: string[] }).deckCheckPhases ?? [],
  );
  expect(phases[0], `${what}, each frame’s phase: ${phases.join(', ')}`).toBe('clip');
  expect(phases, `${what}: never held while its clip loads`).not.toContain('loading');
}

test('a deck slide the operator points at in the list (or whose number is typed) has its first clip ready at the jump’s frame on every hall screen and the stream, and the click plays that very element at once, never holding the slide going away; Next into it alike on the stream (Q57-26)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '2' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const files = await makeDeckFiles(win);
    const id = await writeDeck(win, 'Placeholder pointed deck', standInDecks(files));
    const halls = [
      await outputFor(app, await setUpScreen(win, 'Main Hall', 0)),
      await outputFor(app, await setUpScreen(win, 'Side Hall', 1)),
    ];
    // The stream's picture, as the Stream panel's preview asks for it (the panel itself not opened): an audience's
    // output too.
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
    const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(stream.getByTestId('program-root')).toHaveAttribute('data-warm-up', 'done', {
      timeout: 30_000,
    });
    // Where each loads ahead: an output's Preloader, the stream's deck clips.
    const screens: { page: Page; box: string; name: string }[] = [
      ...halls.map((page, i) => ({ page, box: 'preload', name: `hall screen ${String(i + 1)}` })),
      { page: stream, box: 'deck-clips-ahead', name: 'the stream' },
    ];
    // Its slides as rows in the middle, as an operator chooses it in the library.
    await openLibrary(win);
    await win
      .getByTestId('presentation-list')
      .getByTestId('presentation-row')
      .filter({ hasText: 'Placeholder pointed deck' })
      .click();
    await expect(win.getByTestId('slide-grid')).toHaveAttribute('data-presentation-id', id);
    await closeLibrary(win);
    const row = (index: number) =>
      win.getByTestId('slide-list').locator(`[data-testid="slide-thumb"][data-index="${String(index)}"]`);
    // The deck's first slide up by a click on its row: what Next shows is that slide's own next click, so nothing but
    // the pointing loads the second slide's clip.
    await row(0).click();
    await expect
      .poll(async () => (await state(win)).live)
      .toMatchObject({ presentationId: id, slideIndex: 0 });
    for (const out of halls)
      await expect(out.locator('[data-deck-step="0"]')).toHaveAttribute('data-deck-phase', 'held');
    const ahead = (s: { page: Page; box: string }) =>
      s.page.getByTestId(s.box).locator(`video[data-preload="${files.nextClip}"]`);
    for (const s of screens) await expect(ahead(s)).toHaveCount(0);

    // The pointer comes to rest on the second slide's row: each hall screen and the stream load its first clip, muted
    // and paused, at the frame a click there starts it from (past the deck's own transition), and only it beside
    // Next's.
    const loadedAhead = async () => {
      for (const s of screens) {
        await expect(ahead(s), s.name).toHaveAttribute('data-state', 'ready');
        expect(
          await ahead(s).evaluate((video: HTMLVideoElement) => ({
            at: video.currentTime,
            muted: video.muted,
            paused: video.paused,
            decoded: video.readyState >= 2 && !video.seeking,
          })),
          s.name,
        ).toEqual({ at: TRANSITION_MS / 1000, muted: true, paused: true, decoded: true });
        await expect(s.page.getByTestId(s.box).locator('video[data-deck-ahead]'), s.name).toHaveCount(1);
      }
    };
    await row(1).hover();
    await loadedAhead();
    // The pointer moves off the list: each lets the clip go.
    await win.mouse.move(4, 4);
    for (const s of screens) await expect(ahead(s), s.name).toHaveCount(0);
    // Back on the row, it loads again, and is marked: a check after the click tells the very element plays.
    await row(1).hover();
    await loadedAhead();
    for (const s of screens) {
      await markPrepared(ahead(s));
      await recordPhases(s.page, files.nextClip);
    }

    // The click: a jump, its clip from past the deck's own transition, played on each from the element loaded ahead,
    // from the first frame the slide is drawn: never a frame held on the slide going away while it loads.
    await row(1).click();
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
    expect((await state(win)).layers.slide).toMatchObject({ step: 0, stepFromMs: TRANSITION_MS });
    for (const s of screens) await playedAtOnce(s.page, files.nextClip, `${s.name}, the click`);

    // Next into it in order, from the first slide's last click: the stream now loads Next's first clip ahead as the
    // hall's screens do (from its start: the deck's own transition plays inside it), and plays it at once.
    await win.mouse.move(4, 4);
    await row(0).click();
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(0);
    // The pointer rests on its row on: once its first click goes on (its first clip let go of), each screen loads that
    // clip again, for another click on the row; it lets it go once the pointer moves off.
    const firstClip = files.clips[0] ?? '';
    const firstAhead = (s: { page: Page; box: string }) =>
      s.page.getByTestId(s.box).locator(`video[data-preload="${firstClip}"][data-deck-ahead="pointed"]`);
    await dispatch(win, { type: 'next' });
    await expect.poll(() => step(win)).toBe(1);
    for (const s of screens)
      await expect(firstAhead(s), `${s.name}: loaded again`).toHaveAttribute('data-state', 'ready');
    await win.mouse.move(4, 4);
    for (const s of screens) await expect(firstAhead(s), `${s.name}: let go`).toHaveCount(0);
    await dispatch(win, { type: 'next' });
    await expect.poll(() => step(win)).toBe(2);
    for (const s of screens) {
      const next = s.page
        .getByTestId(s.box)
        .locator(`video[data-preload="${files.nextClip}"][data-deck-ahead="next"]`);
      await expect(next, s.name).toHaveAttribute('data-state', 'ready');
      expect(await next.evaluate((video: HTMLVideoElement) => video.currentTime), s.name).toBe(0);
      await markPrepared(next);
      await recordPhases(s.page, files.nextClip);
    }
    await dispatch(win, { type: 'next' });
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
    for (const s of screens) await playedAtOnce(s.page, files.nextClip, `${s.name}, Next`);

    // Jump to a row: the first slide's number typed (1), the pointer nowhere near its row, points at it as it is typed;
    // Enter puts it up from the element loaded ahead, at once.
    await win.keyboard.press('1');
    for (const s of screens) {
      await expect(firstAhead(s), s.name).toHaveAttribute('data-state', 'ready');
      await markPrepared(firstAhead(s));
      await recordPhases(s.page, firstClip);
    }
    await win.keyboard.press('Enter');
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(0);
    for (const s of screens) await playedAtOnce(s.page, firstClip, `${s.name}, its number typed`);
  } finally {
    await app.close();
  }
});
