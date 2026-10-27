import type { ElectronApplication, Page } from '@playwright/test';
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
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
  testDisplays,
} from './helpers';
import { launchMain, launchNode, pairNode } from './nodes';
import { canvasPixels, near } from './pixels';
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

    await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    // Come to by a jump: its coming-in clip past the deck's own transition; then held at its last frame, red.
    expect((await state(win)).layers.slide).toMatchObject({ step: 0, stepFromMs: TRANSITION_MS });
    await allShow(halls, STEP_COLOURS[0].last, 'the first step’s last frame');
    for (const out of halls)
      await expect(out.locator('[data-deck-step="0"]')).toHaveAttribute('data-deck-phase', 'held');

    // Next with the key: the first click, on both screens, LIVE and the stage; the stage's next is the click after.
    await win.keyboard.press('ArrowRight');
    await expect.poll(() => step(win)).toBe(1);
    // LIVE says which click is up.
    await expect(win.getByTestId('live-text')).toContainText('slide 1 of 2 · click 1 of 2');
    await heldAt([app], win, halls, 300, STEP_COLOURS[1].clip);
    await heldAt([app], win, halls, CLIP_MS + 800, STEP_COLOURS[1].last);
    await holdClock(app, null);
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
    await win.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
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
    const editor = win.getByTestId('slide-editor');
    await expect(editor.getByTestId('editor-canvas')).toBeVisible();
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
    await expectNoSeriousA11yIssues(win, 'a deck’s transitions in the slide editor at 1024 × 645');
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
    ).toHaveAttribute('aria-label', 'The sound on the slide');
  } finally {
    await app.close();
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
    // The node has every clip and last frame by the time the slide is up (copied ahead).
    await dispatch(main.win, { type: 'goLive', presentationId: id, slideIndex: 0 });
    await dispatch(main.win, { type: 'next' });
    const apps = [main.app, node.app];
    const screens = [mainOut, nodeOut, fill];
    await heldAt(apps, main.win, screens, 300, STEP_COLOURS[1].clip);
    await heldAt(apps, main.win, screens, CLIP_MS + 800, STEP_COLOURS[1].last);
    // The key is white where the fill has the deck's picture: over the whole slide.
    await allShow([key], [255, 255, 255], 'the key white over the deck’s picture');
    for (const app of apps) await holdClock(app, null);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});
