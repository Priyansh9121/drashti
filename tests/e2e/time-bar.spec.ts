import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, type Engine, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { holdClock } from './placeholder-slides';
import { makeTestTone, makeTestVideo } from './test-media';
import {
  audioPage,
  backgroundTiming,
  boxTiming,
  clickAlong,
  type Copy,
  dispatch,
  heldAt,
  inStep,
  row,
  slideTiming,
  slideWithVideo,
  snapshot,
  soundTiming,
} from './time-bar-helpers';

/*
 * The time bar (Session 54): under LIVE, one row for each thing playing (the background video, a video on the slide,
 * the picture-in-picture box's video, a single sound, an audio playlist's track, which Music has too), each with its
 * elapsed time and time left, its start and end points and its markers as ticks. In Pro Mode a click or a drag moves
 * it (a drag shows the time under the finger and moves once, on release) and Play and Pause sit beside it: every
 * screen and the audio player land there in step, as a jump to a marker does. Simple Mode shows the bar and its time
 * left and moves nothing. Each fits CI's operator window, 1024 × 645, in both modes. A phone's remote has the same
 * bar (B2). Generated media only, quiet, on displays no wider than 1024; codes and tokens made at run time.
 */

test('the background video: a click on its bar moves it in step on two screens and the audio player; a drag shows the time under the finger and moves once, on release; Pause holds every copy where it is and Play plays them on', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-bg-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder time bar clip.webm'), {
    seconds: 12,
    hue: 30,
    tone: 520,
  });
  const [mediaId = ''] = await importAndGetIds(win, [file]);
  // A marker, a tick on its bar.
  const marked = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.media.setMarkers(id, {
        startMs: null,
        endMs: null,
        markers: [{ id: 'm1', name: 'Placeholder chorus', atMs: 4000 }],
      }),
    mediaId,
  );
  expect(marked.ok).toBe(true);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const o of [a, b]) await outputReady(o);
  const audio = await audioPage(app);
  const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
  const copies: Copy[] = [
    { name: 'the first screen', page: a, selector: picture },
    { name: 'the second screen', page: b, selector: picture },
    { name: 'the audio player', page: audio, selector: `audio[data-media-id="${mediaId}"]`, sound: true },
  ];
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
  });
  // Its row under LIVE: a slider once its length is known, with Pause before it and its marker as a tick.
  const bg = row(win, 'background');
  const bar = bg.getByRole('slider', { name: 'Time of the background video', exact: true });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(bg.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(bg.locator('[data-marker="m1"]')).toHaveCount(1);
  await expect(bg.getByTestId('time-bar-elapsed')).toHaveText(/^\d+:\d\d$/);
  await expect(bg.getByTestId('time-bar-left')).toHaveText(/^-\d+:\d\d$/);
  await inStep(copies, () => backgroundTiming(win), 'playing');
  await expectNoSeriousA11yIssues(win, 'the background video’s time bar');
  const length = (await snapshot(win)).layers.background;
  const durationMs = length?.kind === 'media' ? (length.durationMs ?? 0) : 0;
  expect(durationMs).toBeGreaterThan(10_000);

  // A click three quarters along: everywhere, there.
  await clickAlong(win, bar, 0.75);
  await expect
    .poll(async () => Math.abs(((await backgroundTiming(win)).seek?.toMs ?? 0) - durationMs * 0.75))
    .toBeLessThan(durationMs * 0.03);
  await inStep(copies, () => backgroundTiming(win), 'clicked three quarters along');

  // A drag: the time under the finger shows, nothing moves until it is let go, then it moves there, once.
  const box = await bar.boundingBox();
  if (!box) throw new Error('the bar is not drawn');
  const before = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev,
  );
  const seekBefore = (await backgroundTiming(win)).seek;
  await win.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 });
  await win.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
  const under = bg.getByTestId('time-bar-under');
  await expect(under).toBeVisible();
  await expect(under).toHaveText(/^\d+:\d\d$/);
  const held = Number(await bar.getAttribute('data-held'));
  expect(Math.abs(held - durationMs * 0.3)).toBeLessThan(durationMs * 0.03);
  expect((await backgroundTiming(win)).seek).toEqual(seekBefore);
  await win.mouse.up();
  await expect(under).toHaveCount(0);
  await expect.poll(async () => (await backgroundTiming(win)).seek?.toMs).toBe(held);
  await letTimePass(win, 500, 'nothing else moves it');
  const after = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).rev,
  );
  expect(after - before, 'one move for the whole drag').toBe(1);
  await inStep(copies, () => backgroundTiming(win), 'dragged to three tenths along');

  // Pause: every copy held where the engine's pause put it; the row says so, and offers Play.
  await bg.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
  const paused = (await backgroundTiming(win)).seek?.toMs ?? 0;
  await heldAt(copies, paused / 1000, 'paused');
  await expect(bg.getByTestId('time-bar-paused')).toBeVisible();
  await letTimePass(win, 1500, 'paused, it waits');
  await heldAt(copies, paused / 1000, 'still paused');
  // Moved while paused: it waits at its new point.
  await clickAlong(win, bar, 0.5);
  await expect
    .poll(async () => Math.abs(((await backgroundTiming(win)).seek?.toMs ?? 0) - durationMs * 0.5))
    .toBeLessThan(durationMs * 0.03);
  expect((await backgroundTiming(win)).seek?.paused).toBe(true);
  await heldAt(copies, ((await backgroundTiming(win)).seek?.toMs ?? 0) / 1000, 'moved while paused');
  // Play: on from there, in step.
  await bg.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
  await inStep(copies, () => backgroundTiming(win), 'played on');
  await expect(bg.getByTestId('time-bar-paused')).toHaveCount(0);
  await app.close();
});

test('a video on the slide and the picture-in-picture box’s video: each row moves its own in step on two screens (the slide’s sound too), and pauses it there', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-slide-'));
  const onSlide = await makeTestVideo(win, join(dir, 'Placeholder slide clip.webm'), {
    seconds: 12,
    hue: 200,
    tone: 330,
  });
  const inBox = await makeTestVideo(win, join(dir, 'Placeholder box clip.webm'), { seconds: 10, hue: 120 });
  const [slideVideo = '', boxVideo = ''] = await importAndGetIds(win, [onSlide, inBox]);
  const presentationId = await slideWithVideo(win, dir, slideVideo);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const o of [a, b]) await outputReady(o);
  const audio = await audioPage(app);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: boxVideo } });

  // The slide's video: its own row, moved in step on both screens and in the audio player (its sound).
  const slidePicture = `[data-layer="slide"] video[data-media-id="${slideVideo}"]`;
  const slideCopies: Copy[] = [
    { name: 'the first screen', page: a, selector: slidePicture },
    { name: 'the second screen', page: b, selector: slidePicture },
    {
      name: 'the audio player',
      page: audio,
      selector: `audio[data-key^="slide:"][data-media-id="${slideVideo}"]`,
      sound: true,
    },
  ];
  const slideRow = row(win, `slide:${slideVideo}`);
  const slideBar = slideRow.getByRole('slider', { name: 'Time of the video on the slide', exact: true });
  await expect(slideBar).toBeVisible({ timeout: 15_000 });
  const slideLength = (await snapshot(win)).videoFiles?.[slideVideo]?.durationMs ?? 0;
  expect(slideLength).toBeGreaterThan(10_000);
  await inStep(slideCopies, () => slideTiming(win, slideVideo, true), 'the slide’s video playing');
  await clickAlong(win, slideBar, 0.6);
  await expect
    .poll(async () =>
      Math.abs(((await slideTiming(win, slideVideo, true)).seek?.toMs ?? 0) - slideLength * 0.6),
    )
    .toBeLessThan(slideLength * 0.03);
  await inStep(slideCopies, () => slideTiming(win, slideVideo, true), 'the slide’s video moved');
  // Paused there: both screens and its sound wait at the same point; played on, in step again.
  await slideRow.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await slideTiming(win, slideVideo, true)).seek?.paused).toBe(true);
  const waits = ((await slideTiming(win, slideVideo, true)).seek?.toMs ?? 0) / 1000;
  await heldAt(slideCopies, waits, 'the slide’s video paused');
  await slideRow.getByRole('button', { name: 'Play' }).click();
  await inStep(slideCopies, () => slideTiming(win, slideVideo, true), 'the slide’s video played on');

  // The box's video: its own row, moved in step on both screens (the box makes no sound).
  const boxPicture = `[data-testid="pip-box"] [data-pip-picture="media"] video[data-media-id="${boxVideo}"]`;
  const boxCopies: Copy[] = [
    { name: 'the first screen', page: a, selector: boxPicture },
    { name: 'the second screen', page: b, selector: boxPicture },
  ];
  const boxRow = row(win, 'pip');
  const boxBar = boxRow.getByRole('slider', {
    name: 'Time of the video in the picture-in-picture box',
    exact: true,
  });
  await expect(boxBar).toBeVisible({ timeout: 15_000 });
  const boxLength = (await snapshot(win)).videoFiles?.[boxVideo]?.durationMs ?? 0;
  expect(boxLength).toBeGreaterThan(8000);
  await clickAlong(win, boxBar, 0.25);
  await expect
    .poll(async () => Math.abs(((await boxTiming(win, boxVideo)).seek?.toMs ?? 0) - boxLength * 0.25))
    .toBeLessThan(boxLength * 0.03);
  await inStep(boxCopies, () => boxTiming(win, boxVideo), 'the box’s video moved');
  await boxRow.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await boxTiming(win, boxVideo)).seek?.paused).toBe(true);
  await heldAt(
    boxCopies,
    ((await boxTiming(win, boxVideo)).seek?.toMs ?? 0) / 1000,
    'the box’s video paused',
  );
  // The slide's video plays on meanwhile: each row moves only its own.
  await inStep(slideCopies, () => slideTiming(win, slideVideo, true), 'the slide’s video, untouched');
  await expectNoSeriousA11yIssues(win, 'the slide’s and the box’s time bars');
  await app.close();
});

test('a single sound and an audio playlist’s track: moved in step in the audio player, the track from Music’s bar too, on to the next track at its end', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-sound-'));
  const [long = '', one = '', two = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder long tone.wav'), { seconds: 40, hz: 440 }),
    makeTestTone(join(dir, 'Placeholder track one.wav'), { seconds: 20, hz: 330 }),
    makeTestTone(join(dir, 'Placeholder track two.wav'), { seconds: 12, hz: 550 }),
  ]);
  const audio = await audioPage(app);
  const copy = (id: string): Copy[] => [
    { name: 'the audio player', page: audio, selector: `audio[data-media-id="${id}"]` },
  ];
  await dispatch(win, {
    type: 'playAudio',
    audio: { id: 'placeholder-sound', title: 'Placeholder sound', mediaId: long, volume: 1, loop: false },
  });
  const soundRow = row(win, 'audio');
  const soundBar = soundRow.getByRole('slider', { name: 'Time of the sound playing', exact: true });
  await expect(soundBar).toBeVisible({ timeout: 15_000 });
  await clickAlong(win, soundBar, 0.5);
  await expect
    .poll(async () => Math.abs(((await soundTiming(win)).seek?.toMs ?? 0) - 20_000))
    .toBeLessThan(1200);
  await inStep(copy(long), () => soundTiming(win), 'the sound moved');
  await soundRow.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await soundTiming(win)).seek?.paused).toBe(true);
  await heldAt(copy(long), ((await soundTiming(win)).seek?.toMs ?? 0) / 1000, 'the sound paused');
  await soundRow.getByRole('button', { name: 'Play' }).click();
  await inStep(copy(long), () => soundTiming(win), 'the sound played on');

  // An audio playlist's track: under LIVE and in Music, the same bar.
  const listId = await win.evaluate(
    async ({ one, two }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.music.create('Placeholder before sabha');
      if (!list.ok || !list.id) throw new Error('not made');
      await d.music.addTracks(list.id, [one, two], null);
      return list.id;
    },
    { one, two },
  );
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.music.play(id, 0), listId);
  await expect.poll(async () => (await snapshot(win)).layers.audio?.mediaId).toBe(one);
  const musicBar = win
    .getByTestId('music-panel')
    .getByRole('slider', { name: 'Time of the track playing', exact: true });
  await expect(musicBar).toBeVisible({ timeout: 15_000 });
  await expect(
    row(win, 'audio').getByRole('slider', { name: 'Time of the music playing', exact: true }),
  ).toBeVisible();
  await clickAlong(win, musicBar, 0.5);
  await expect
    .poll(async () => Math.abs(((await soundTiming(win)).seek?.toMs ?? 0) - 10_000))
    .toBeLessThan(800);
  await inStep(copy(one), () => soundTiming(win), 'the track moved from Music');
  // At its end: on to the next track, as at any end.
  await clickAlong(win, musicBar, 0.995);
  await expect.poll(async () => (await snapshot(win)).layers.audio?.mediaId).toBe(two);
  await inStep(copy(two), () => soundTiming(win), 'the next track');
  await expectNoSeriousA11yIssues(win, 'the sound’s and Music’s time bars');
  await app.close();
});

test('Simple Mode shows the bar and its time left and moves nothing (no move, no skip, no Pause but the music’s; Play always); the bars fit 1024 × 645 in both modes', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // CI's operator window, about 1024 × 645.
  await win.setViewportSize({ width: 1024, height: 645 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-simple-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder simple clip.webm'), { seconds: 10, hue: 300 });
  const [mediaId = '', tone = ''] = await importAndGetIds(win, [
    file,
    makeTestTone(join(dir, 'Placeholder simple tone.wav'), { seconds: 30, hz: 440 }),
  ]);
  await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
  });
  await dispatch(win, {
    type: 'playAudio',
    audio: { id: 'placeholder-sound', title: 'Placeholder sound', mediaId: tone, volume: 1, loop: false },
  });
  /** Each row whole inside the window and its column, nothing past their edges, Next (Pro Mode's, over the bars) in view. */
  const fits = async (mode: string, next: Locator) => {
    const rows = win.getByTestId('time-bar-row');
    await expect(rows).toHaveCount(2);
    for (const r of await rows.all()) {
      await expect(r).toBeVisible();
      const box = await r.boundingBox();
      if (!box) throw new Error(`${mode}: a row is not drawn`);
      expect(box.x + box.width, `${mode}: the row inside the window`).toBeLessThanOrEqual(1024);
      expect(
        await r.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `${mode}: nothing past the row`,
      ).toBe(true);
    }
    const shown = await next.boundingBox();
    if (!shown) throw new Error(`${mode}: Next is not drawn`);
    expect(shown.y + shown.height, `${mode}: Next in view, the bars under it`).toBeLessThanOrEqual(645);
  };

  // Pro Mode: the bars move, with Pause before each.
  await expect(row(win, 'background').getByRole('slider')).toBeVisible({ timeout: 15_000 });
  await expect(row(win, 'audio').getByRole('slider')).toBeVisible({ timeout: 15_000 });
  await fits('Pro Mode', win.getByTestId('show-next'));
  await expectNoSeriousA11yIssues(win, 'the time bars at 1024 × 645, Pro Mode');
  // The sound paused in Pro Mode: Simple Mode can play it on (it has no Play of its own), never pause it again.
  await row(win, 'audio').getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await soundTiming(win)).seek?.paused).toBe(true);

  // Simple Mode: the bar and its time left, no elapsed time, no Play or Pause, nothing to move.
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const bg = row(win, 'background');
  const shows = bg.getByRole('progressbar', { name: 'Time of the background video', exact: true });
  await expect(shows).toBeVisible();
  await expect(bg.getByRole('slider')).toHaveCount(0);
  await expect(bg.getByTestId('time-bar-left')).toHaveText(/^-\d+:\d\d$/);
  await expect(bg.getByTestId('time-bar-elapsed')).toHaveCount(0);
  await expect(win.getByTestId('time-bar-pause')).toHaveCount(0);
  await expect(win.getByTestId('time-bar-play')).toHaveCount(0);
  await fits('Simple Mode', win.getByTestId('simple-buttons'));
  const seek = (await backgroundTiming(win)).seek;
  await clickAlong(win, shows, 0.8);
  await letTimePass(win, 500, 'a click on Simple Mode’s bar moves nothing');
  expect((await backgroundTiming(win)).seek).toEqual(seek);
  // The engine refuses a move in Simple Mode, from the window, a phone or the API alike, and so Back 15 s and the
  // rest, and the bar's Pause; never Play, so nothing paused stays so (Session 54's review).
  for (const command of [
    { type: 'moveTo', playing: { layer: 'background' }, toMs: 1000 },
    { type: 'skip', layer: 'background', jump: 'back' },
    { type: 'pausePlaying', playing: { layer: 'background' } },
  ])
    expect(await dispatch(win, command), JSON.stringify(command)).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
  expect((await backgroundTiming(win)).seek).toEqual(seek);
  await expect(row(win, 'audio').getByTestId('time-bar-paused')).toBeVisible();
  expect(await dispatch(win, { type: 'resumePlaying', playing: { layer: 'audio' } })).toMatchObject({
    ok: true,
  });
  await expect.poll(async () => (await soundTiming(win)).seek?.paused).toBeUndefined();
  await expect(row(win, 'audio').getByTestId('time-bar-paused')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'the time bars at 1024 × 645, Simple Mode');
  await app.close();
});

for (const engine of ['chromium', 'webkit'] as Engine[]) {
  test(`the phone’s bar (${engine}): the same rows under its live picture; a tap or a drag moves what plays in step on the screen, Pause and Play too; Simple Mode refuses the move and the Pause and says so, never the Play`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-phone-'));
    const file = await makeTestVideo(win, join(dir, 'Placeholder phone clip.webm'), {
      seconds: 10,
      hue: 60,
      tone: 440,
    });
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    await setUpScreen(win);
    const hall = await outputPage(app);
    await outputReady(hall);
    const audio = await audioPage(app);
    const copies: Copy[] = [
      {
        name: 'the screen',
        page: hall,
        selector: `[data-layer="background"] video[data-media-id="${mediaId}"]`,
      },
      { name: 'the audio player', page: audio, selector: `audio[data-media-id="${mediaId}"]`, sound: true },
    ];
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
    });
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      const playing = p.getByTestId('remote-time-bars');
      const row = playing.locator('[data-testid="remote-time-bar-row"][data-playing="background"]');
      const bar = row.getByRole('slider', { name: 'Time of the background video', exact: true });
      await expect(bar).toBeVisible({ timeout: 15_000 });
      // A finger's size: the bar and its button 44 px tall at least.
      for (const target of [bar, row.getByRole('button', { name: 'Pause' })]) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(row.getByTestId('remote-time-bar-left')).toHaveText(/^-\d+:\d\d$/);
      await expectNoSeriousA11yIssues(p, `the phone’s time bar (${engine})`);
      const bg = (await snapshot(win)).layers.background;
      const durationMs = bg?.kind === 'media' ? (bg.durationMs ?? 0) : 0;
      expect(durationMs).toBeGreaterThan(8000);

      // A tap halfway along: the screen and the audio player land there in step.
      await clickAlong(p, bar, 0.5);
      await expect
        .poll(async () => Math.abs(((await backgroundTiming(win)).seek?.toMs ?? 0) - durationMs * 0.5))
        .toBeLessThan(durationMs * 0.04);
      await inStep(copies, () => backgroundTiming(win), 'tapped halfway along on the phone');

      // A drag: the time under the finger shows, and it moves once, as the finger lets go.
      const box = await bar.boundingBox();
      if (!box) throw new Error('the bar is not drawn');
      const seekBefore = (await backgroundTiming(win)).seek;
      await p.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
      await p.mouse.down();
      await p.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
      await expect(row.getByTestId('remote-time-bar-under')).toBeVisible();
      const held = Number(await bar.getAttribute('data-held'));
      expect((await backgroundTiming(win)).seek).toEqual(seekBefore);
      await p.mouse.up();
      await expect.poll(async () => (await backgroundTiming(win)).seek?.toMs).toBe(held);
      await inStep(copies, () => backgroundTiming(win), 'dragged on the phone');

      // Pause and Play, from the phone.
      await row.getByRole('button', { name: 'Pause' }).click();
      await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
      await heldAt(copies, ((await backgroundTiming(win)).seek?.toMs ?? 0) / 1000, 'paused from the phone');
      await expect(row).toContainText('Paused');
      await row.getByRole('button', { name: 'Play' }).click();
      await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
      await inStep(copies, () => backgroundTiming(win), 'played on from the phone');

      // Simple Mode on the computer, the video left paused: the phone's move and Pause are refused, the phone saying
      // why, and nothing moves; its Play is not, so nothing stays paused (Session 54's review).
      await row.getByRole('button', { name: 'Pause' }).click();
      await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
      await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      const seek = (await backgroundTiming(win)).seek;
      await clickAlong(p, bar, 0.9);
      await expect(p.getByText('Simple Mode is on', { exact: false })).toBeVisible();
      expect((await backgroundTiming(win)).seek).toEqual(seek);
      await row.getByRole('button', { name: 'Play' }).click();
      await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
      await inStep(copies, () => backgroundTiming(win), 'played on from the phone in Simple Mode');
      const playedOn = (await backgroundTiming(win)).seek;
      await row.getByRole('button', { name: 'Pause' }).click();
      await expect(p.getByText('Simple Mode is on', { exact: false })).toBeVisible();
      expect((await backgroundTiming(win)).seek).toEqual(playedOn);
    } finally {
      await phone.close();
    }
    await app.close();
  });
}

/** Open the slide editor on a presentation, by its row in the library. */
async function openEditor(win: Page, name: string): Promise<Locator> {
  await openLibrary(win);
  await win
    .getByTestId('presentation-list')
    .getByTestId('presentation-row')
    .filter({ hasText: name })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('editor-canvas')).toBeVisible();
  return editor;
}

/** In the slide editor: the video's own "Show the play bar on the screens", set as asked, then saved. */
async function setPlayBar(win: Page, on: boolean): Promise<void> {
  const editor = await openEditor(win, 'Placeholder Play Bar');
  // The video sits in the slide's top right quarter, over the words: a click in its middle chooses it.
  const canvas = editor.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  const scale = Number(await canvas.getAttribute('data-scale'));
  if (!box) throw new Error('no canvas');
  await win.mouse.click(box.x + 1440 * scale, box.y + 270 * scale);
  await expect(editor.getByTestId('inspector-media')).toBeVisible();
  const toggle = editor.getByTestId('field-play-bar');
  await expect(toggle).toHaveAttribute('aria-checked', String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  if (on) await expectNoSeriousA11yIssues(win, 'a video’s settings with its play bar');
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);
}

test('the play bar on the screens: off unless ticked; ticked in the slide editor, both screens draw it along the bottom of the slide’s video, the same at the same moment, its mark following Pause and Play; unticked, gone', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 900 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-play-bar-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder play bar clip.webm'), {
    seconds: 10,
    hue: 160,
  });
  const [mediaId = ''] = await importAndGetIds(win, [file]);
  const presentationId = await slideWithVideo(win, dir, mediaId, true);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const screens = outputPages(app) as [Page, Page];
  for (const o of screens) await outputReady(o);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  const video = (o: Page) => o.locator(`[data-layer="slide"] video[data-media-id="${mediaId}"]`);
  const playBar = (o: Page) => o.locator('[data-layer="slide"] [data-play-bar]');
  for (const o of screens) await expect(video(o)).toHaveCount(1);
  // Off unless ticked: no bar on either screen.
  for (const o of screens) await expect(playBar(o)).toHaveCount(0);

  // Ticked: both screens draw it along the bottom of the video, playing (a pause mark, as a deck's video shows).
  await setPlayBar(win, true);
  const element = await win.evaluate(async (id) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(id);
    return doc?.groups[0]?.slides[0]?.slide.elements.find((e) => e.kind === 'video') ?? null;
  }, presentationId);
  expect(element).toMatchObject({ kind: 'video', playBar: true });
  for (const o of screens) {
    await expect(playBar(o)).toHaveAttribute('data-state', 'playing');
    await expect(playBar(o).locator('svg[data-mark="pause"]')).toHaveCount(1);
    await expect(playBar(o).locator('[data-play-bar-time]')).toHaveText(/^\d+:\d\d \/ \d+:\d\d$/);
    const bar = await playBar(o).locator(':scope > div').boundingBox();
    const shown = await video(o).boundingBox();
    if (!bar || !shown) throw new Error('not drawn');
    expect(Math.abs(bar.y + bar.height - (shown.y + shown.height)), 'along the video’s bottom').toBeLessThan(
      1.5,
    );
    expect(Math.abs(bar.width - shown.width), 'as wide as the video').toBeLessThan(1.5);
  }
  // Held at one moment (the engine's time), the two screens draw the same bar.
  const drawn = (o: Page) =>
    playBar(o)
      .locator(':scope > div')
      .evaluate(
        (el) =>
          `${el.dataset['fraction'] ?? ''} ${el.querySelector('[data-play-bar-time]')?.textContent ?? ''}`,
      );
  await holdClock(app, Date.now());
  try {
    await expect.poll(async () => (await drawn(screens[0])) === (await drawn(screens[1]))).toBe(true);
  } finally {
    await holdClock(app, null);
  }

  // Paused from LIVE's time bar: a play mark on both, at the same place, waiting.
  await row(win, `slide:${mediaId}`).getByRole('button', { name: 'Pause' }).click();
  for (const o of screens) {
    await expect(playBar(o)).toHaveAttribute('data-state', 'paused');
    await expect(playBar(o).locator('svg[data-mark="play"]')).toHaveCount(1);
  }
  await expect.poll(async () => (await drawn(screens[0])) === (await drawn(screens[1]))).toBe(true);
  const waiting = await drawn(screens[0]);
  await letTimePass(win, 1000, 'paused, its bar waits');
  expect(await drawn(screens[0])).toBe(waiting);
  await row(win, `slide:${mediaId}`).getByRole('button', { name: 'Play' }).click();
  for (const o of screens) await expect(playBar(o)).toHaveAttribute('data-state', 'playing');

  // Unticked: gone from both screens, the video playing on.
  await setPlayBar(win, false);
  for (const o of screens) await expect(playBar(o)).toHaveCount(0);
  for (const o of screens) await expect(video(o)).toHaveCount(1);
  await app.close();
});
