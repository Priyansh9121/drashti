import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputPages,
  outputReady,
  relaunchApp,
  savedLive,
  setUpScreen,
  testDisplays,
} from './helpers';
import { launchMain, launchNode, type MainRun, type NodeRun, pairNode } from './nodes';
import { makeTestTone, makeTestVideo, setWebmDuration } from './test-media';
import {
  audioPage,
  backgroundTiming,
  clickAlong,
  type Copy,
  dispatch,
  heldAt,
  inStep,
  logoTiming,
  propTiming,
  row,
  slideTiming,
  slideWithVideo,
  slideWithVideos,
  snapshot,
  soundTiming,
  type Timing,
} from './time-bar-helpers';

/*
 * The time bar beyond Main's own screens (Session 54's review): a node's screen beside Main's and a key and fill pair
 * land on a Pause and a Play as Main's do; a prop's looping video and the logo's are moved and paused in step by bars of
 * their own (the owner's answer of 28 Oct); what was paused and moved comes back after a crash where it would be; and the worst fit, every
 * kind playing at once, one paused, one file hours long, fits CI's operator window in Pro and Simple Mode and a phone
 * and a tablet, Next and Back never moving. Generated media only, quiet; codes and tokens made at run time.
 */

/** A file played as the background, looping, from a screen of Drashti's (the window's own engine). */
const backgroundVideo = (win: Page, mediaId: string) =>
  dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
  });

/** Each window's copy of the background video. */
const backgroundCopies = (pages: { name: string; page: Page }[], mediaId: string): Copy[] =>
  pages.map(({ name, page }) => ({
    name,
    page,
    selector: `[data-layer="background"] video[data-media-id="${mediaId}"]`,
  }));

/** The background row's Pause, then its Play, once its length is known. */
async function pauseThenPlay(win: Page, copies: Copy[]): Promise<void> {
  const bg = row(win, 'background');
  await expect(bg.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
  await bg.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
  const waits = ((await backgroundTiming(win)).seek?.toMs ?? 0) / 1000;
  await heldAt(copies, waits, 'paused from the bar');
  await bg.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBeUndefined();
  await inStep(copies, () => backgroundTiming(win), 'played on from the bar');
}

/** Put the node's second display (its pretend extra one) into a group, and wait for its output. */
async function nodeScreenIn(main: MainRun, node: NodeRun, nodeId: string, groupId: string): Promise<Page> {
  const displays = async () =>
    main.win.evaluate(
      async (id) =>
        (
          (await (globalThis as PageGlobals).drashti.screens.get()).nodes.find((n) => n.id === id)
            ?.displays ?? []
        ).map((d) => d.id),
      nodeId,
    );
  await expect.poll(async () => (await displays()).length).toBeGreaterThanOrEqual(2);
  const displayId = (await displays())[1] ?? -1;
  const assigned = await main.win.evaluate(
    ({ groupId, nodeId, displayId }) =>
      (globalThis as PageGlobals).drashti.screens.assignNodeDisplay(groupId, nodeId, displayId),
    { groupId, nodeId, displayId },
  );
  expect(assigned.ok).toBe(true);
  return outputPage(node.app);
}

test('a node’s screen beside Main’s: Pause from the bar holds both where the engine’s pause put them, and Play brings them back in step', async () => {
  test.setTimeout(240_000);
  const main = await launchMain();
  const node = await launchNode();
  try {
    const nodeId = await pairNode(main, node);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-node-'));
    const file = await makeTestVideo(main.win, join(dir, 'Placeholder node clip.webm'), {
      seconds: 10,
      hue: 90,
    });
    const [mediaId = ''] = await importAndGetIds(main.win, [file]);
    await setUpScreen(main.win, 'Placeholder Hall', 1);
    const groupId = await main.win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.screens.get()).groups.find(
          (g) => g.name === 'Placeholder Hall',
        )?.id ?? '',
    );
    const mainOut = await outputPage(main.app);
    const nodeOut = await nodeScreenIn(main, node, nodeId, groupId);
    for (const o of [mainOut, nodeOut]) await outputReady(o);
    await backgroundVideo(main.win, mediaId);
    const copies = backgroundCopies(
      [
        { name: 'Main’s screen', page: mainOut },
        { name: 'the node’s screen', page: nodeOut },
      ],
      mediaId,
    );
    // The node fetches its copy as the video goes up, and plays it when it lands.
    await expect
      .poll(
        () =>
          nodeOut.evaluate((s) => {
            const v = document.querySelector<HTMLVideoElement>(s);
            return Boolean(v && v.readyState >= 2 && !v.paused);
          }, copies[1]?.selector ?? ''),
        { timeout: 30_000 },
      )
      .toBe(true);
    await inStep(copies, () => backgroundTiming(main.win), 'playing on Main’s screen and the node’s');
    await pauseThenPlay(main.win, copies);
  } finally {
    await node.app.close();
    await main.app.close();
  }
});

/** Its output, by its screen's id. */
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
  return found;
}

test('the key and the fill: a slide’s video (a key and fill pair keys the slide, its props and messages, never the background), Pause from its bar holding both feeds where the engine’s pause put them, and Play bringing them back in step', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-keyfill-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder keyed clip.webm'), { seconds: 10, hue: 20 });
  const [mediaId = ''] = await importAndGetIds(win, [file]);
  // A slide of the video alone: a key and fill group draws slides as lower thirds, a slide's words alone and a slide
  // of pictures whole (render/SlideLayerView.tsx), and never the background (look-service.ts becameKeyFill).
  const presentationId = await slideWithVideos(win, dir, 'Placeholder Keyed Video', [mediaId], {
    alone: true,
  });
  // A key and fill group on the two displays (as keyfill.spec.ts makes it): its fill's and its key's outputs.
  const on = (await testDisplays(win)).map((x) => x.id);
  const screens = await win.evaluate(async (on) => {
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
    return (await d.screens.get()).groups.find((g) => g.id === group?.id)?.screens ?? [];
  }, on);
  expect(screens.map((s) => s.feed)).toEqual(['fill', 'key']);
  const fill = await outputFor(app, screens[0]?.id ?? '');
  const key = await outputFor(app, screens[1]?.id ?? '');
  for (const o of [fill, key]) await outputReady(o);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  const picture = `[data-layer="slide"] video[data-media-id="${mediaId}"]`;
  const copies: Copy[] = [
    { name: 'the fill', page: fill, selector: picture },
    { name: 'the key', page: key, selector: picture },
  ];
  const timing = () => slideTiming(win, mediaId, true);
  await inStep(copies, timing, 'playing on the fill and the key');
  // Paused from the slide's video's own bar under LIVE: both feeds held where the engine's pause put it.
  const slideRow = row(win, `slide:${mediaId}`);
  await expect(slideRow.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
  await slideRow.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await timing()).seek?.paused).toBe(true);
  await heldAt(copies, ((await timing()).seek?.toMs ?? 0) / 1000, 'paused from the bar');
  // Played on: both back in step.
  await slideRow.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await timing()).seek?.paused).toBeUndefined();
  await inStep(copies, timing, 'played on from the bar');
  await app.close();
});

test('a prop’s looping video and the logo’s have bars of their own under LIVE: a click along moves each, and its Pause and Play hold it and play it on, in step on two screens', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-prop-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder prop clip.webm'), { seconds: 10, hue: 250 });
  const mark = await makeTestVideo(win, join(dir, 'Placeholder logo clip.webm'), { seconds: 10, hue: 30 });
  const [mediaId = '', logoMediaId = ''] = await importAndGetIds(win, [file, mark]);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const o of [a, b]) await outputReady(o);
  const looping = (id: string, media: string) => ({
    id,
    kind: 'video' as const,
    mediaId: media,
    frame: { x: 1280, y: 0, width: 640, height: 360 },
    fit: 'fit' as const,
    loop: true,
  });
  const onBoth = (selector: string): Copy[] => [
    { name: 'the first screen', page: a, selector },
    { name: 'the second screen', page: b, selector },
  ];

  /** By its own row under LIVE: a click halfway along moves it there everywhere, Pause holds it, Play plays it on. */
  async function byItsBar(
    which: string,
    media: string,
    copies: Copy[],
    timing: () => Promise<Timing>,
    what: string,
  ) {
    await inStep(copies, timing, `${what}, playing`);
    await expect
      .poll(async () => (await snapshot(win)).videoFiles?.[media]?.durationMs ?? 0)
      .toBeGreaterThan(8000);
    const length = (await snapshot(win)).videoFiles?.[media]?.durationMs ?? 0;
    const itsRow = row(win, which);
    const bar = itsRow.getByRole('slider');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await bar.scrollIntoViewIfNeeded();
    await clickAlong(win, bar, 0.5);
    await expect
      .poll(async () => Math.abs(((await timing()).seek?.toMs ?? 0) - length * 0.5))
      .toBeLessThan(length * 0.03);
    await inStep(copies, timing, `${what}, moved halfway`);
    await itsRow.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await timing()).seek?.paused).toBe(true);
    await heldAt(copies, ((await timing()).seek?.toMs ?? 0) / 1000, `${what}, paused`);
    await itsRow.getByRole('button', { name: 'Play' }).click();
    await expect.poll(async () => (await timing()).seek?.paused).toBeUndefined();
    await inStep(copies, timing, `${what}, played on`);
  }

  const propId = 'placeholder-prop';
  await dispatch(win, {
    type: 'showProp',
    prop: { id: propId, name: 'Placeholder prop', elements: [looping('placeholder-prop-video', mediaId)] },
  });
  const propRow = `props:${propId}:${mediaId}`;
  await expect(row(win, propRow)).toHaveAttribute(
    'aria-label',
    'Time of the video in the prop “Placeholder prop”',
  );
  await byItsBar(
    propRow,
    mediaId,
    onBoth(`[data-layer="props"] video[data-media-id="${mediaId}"]`),
    () => propTiming(win, propId, mediaId, true),
    'the prop’s video',
  );
  // Taken down, its row goes.
  await dispatch(win, { type: 'hideProp', propId });
  await expect(row(win, propRow)).toHaveCount(0);

  // The logo, with a looping video of its own: a row and a bar of its own, alike.
  await dispatch(win, {
    type: 'showLogo',
    prop: {
      id: 'placeholder-logo',
      name: 'Placeholder logo',
      elements: [looping('placeholder-logo-video', logoMediaId)],
    },
  });
  const logoRow = `logo:${logoMediaId}`;
  await expect(row(win, logoRow)).toHaveAttribute('aria-label', 'Time of the logo’s video');
  await byItsBar(
    logoRow,
    logoMediaId,
    onBoth(`[data-layer="logo"] video[data-media-id="${logoMediaId}"]`),
    () => logoTiming(win, logoMediaId, true),
    'the logo’s video',
  );
  await dispatch(win, { type: 'hideLogo' });
  await expect(row(win, logoRow)).toHaveCount(0);
  await app.close();
});

test('after a crash, a background the bar paused comes back held where it waited, and a slide’s video it moved plays on from its move, where it would be by now', async () => {
  test.setTimeout(180_000);
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-recovery-'));
  const behind = await makeTestVideo(win, join(dir, 'Placeholder held clip.webm'), { seconds: 10, hue: 140 });
  const onSlide = await makeTestVideo(win, join(dir, 'Placeholder moved clip.webm'), {
    seconds: 10,
    hue: 320,
  });
  const [bgId = '', slideId = ''] = await importAndGetIds(win, [behind, onSlide]);
  const presentationId = await slideWithVideo(win, dir, slideId);
  await setUpScreen(win);
  await outputPage(first.app);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await backgroundVideo(win, bgId);
  // The background paused from its bar; the slide's video moved to three quarters from its bar.
  const bg = row(win, 'background');
  await expect(bg.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
  await bg.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await backgroundTiming(win)).seek?.paused).toBe(true);
  const slideBar = row(win, `slide:${slideId}`).getByRole('slider');
  await expect(slideBar).toBeVisible({ timeout: 15_000 });
  await clickAlong(win, slideBar, 0.75);
  await expect
    .poll(async () => (await slideTiming(win, slideId, true)).seek?.toMs ?? 0)
    .toBeGreaterThan(5000);
  const held = (await backgroundTiming(win)).seek;
  const moved = (await slideTiming(win, slideId, true)).seek;
  // Saved with both, then stopped dead.
  await savedLive(first.userData, (saved) => {
    const background = saved.background as { seek?: { paused?: boolean } } | null | undefined;
    const slide = saved.slide as { seeks?: Record<string, unknown> } | null | undefined;
    return background?.seek?.paused === true && slide?.seeks?.[slideId] !== undefined;
  });
  await killApp(first.app);

  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  expect((await backgroundTiming(win2)).seek).toEqual(held);
  expect((await slideTiming(win2, slideId, true)).seek).toEqual(moved);
  const out = await outputPage(second.app);
  await outputReady(out);
  // Held where it waited, on the screen; the slide's video on from its move, where the clock has it now.
  await heldAt(
    backgroundCopies([{ name: 'the screen', page: out }], bgId),
    (held?.toMs ?? 0) / 1000,
    'held after the restart',
  );
  await inStep(
    [{ name: 'the screen', page: out, selector: `[data-layer="slide"] video[data-media-id="${slideId}"]` }],
    () => slideTiming(win2, slideId, true),
    'played on from its move after the restart',
  );
  await expect(row(win2, 'background').getByTestId('time-bar-paused')).toBeVisible();
  await second.app.close();
});

/** A WebM that says it is two hours long (its first seconds recorded): the bar's longest times, h:mm:ss. */
async function twoHourVideo(win: Page, file: string): Promise<string> {
  const made = await makeTestVideo(win, file, { seconds: 4, hue: 10 });
  writeFileSync(made, setWebmDuration(readFileSync(made), 2 * 3600 * 1000));
  return made;
}

/** The rows of the time bar in the operator window. */
const rows = (win: Page): Locator => win.getByTestId('time-bar-row');

/** Each row of the bar inside the window, nothing past its edges, its times whole. */
async function rowsFit(page: Page, rows: Locator, width: number, what: string): Promise<void> {
  for (const r of await rows.all()) {
    await r.scrollIntoViewIfNeeded();
    await expect(r).toBeVisible();
    const box = await r.boundingBox();
    if (!box) throw new Error(`${what}: a row is not drawn`);
    expect(box.x + box.width, `${what}: a row inside the window`).toBeLessThanOrEqual(width);
    expect(await r.evaluate((el) => el.scrollWidth <= el.clientWidth), `${what}: nothing past a row`).toBe(
      true,
    );
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${what}: the page never scrolls sideways`,
  ).toBe(true);
}

test('the worst fit: the background (two hours long, paused), two slide videos, a prop’s and the logo’s videos, the box and a sound at once fit 1024 × 645 in Pro and Simple Mode, Next and Back never moving, and a phone and a tablet at 44 px', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  // CI's operator window, about 1024 × 645.
  await win.setViewportSize({ width: 1024, height: 645 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-fit-'));
  const long = await twoHourVideo(win, join(dir, 'Placeholder two hours.webm'));
  const one = await makeTestVideo(win, join(dir, 'Placeholder slide one.webm'), { seconds: 4, hue: 100 });
  const two = await makeTestVideo(win, join(dir, 'Placeholder slide two.webm'), { seconds: 4, hue: 200 });
  const boxed = await makeTestVideo(win, join(dir, 'Placeholder boxed.webm'), { seconds: 4, hue: 300 });
  const propped = await makeTestVideo(win, join(dir, 'Placeholder propped.webm'), { seconds: 4, hue: 40 });
  const marked = await makeTestVideo(win, join(dir, 'Placeholder marked.webm'), { seconds: 4, hue: 160 });
  const tone = makeTestTone(join(dir, 'Placeholder fit tone.wav'), { seconds: 60, hz: 440 });
  const [longId = '', oneId = '', twoId = '', boxedId = '', proppedId = '', markedId = '', toneId = ''] =
    await importAndGetIds(win, [long, one, two, boxed, propped, marked, tone]);
  const videoOf = (id: string, mediaId: string) => ({
    id,
    kind: 'video' as const,
    mediaId,
    frame: { x: 1280, y: 0, width: 640, height: 360 },
    fit: 'fit' as const,
    loop: true,
  });
  const presentationId = await slideWithVideos(win, dir, 'Placeholder Two Videos', [oneId, twoId]);
  await setUpScreen(win);
  await outputPage(app);
  // Where Next and Back are with the slide and the box up (the box's own line is under the LIVE picture), before the
  // background and the sound start: their bars come under Next and Back, which never move for them.
  const next = win.getByTestId('show-next');
  const back = win.getByTestId('show-back');
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: boxedId } });
  await expect(rows(win)).toHaveCount(3);
  const nextAt = (await next.boundingBox())?.y ?? -1;
  const backAt = (await back.boundingBox())?.y ?? -1;
  await backgroundVideo(win, longId);
  await dispatch(win, {
    type: 'playAudio',
    audio: { id: 'placeholder-sound', title: 'Placeholder sound', mediaId: toneId, volume: 1, loop: false },
  });
  // A prop's video and the logo's (the owner's answer of 28 Oct: every video has a bar): seven rows in all.
  await dispatch(win, {
    type: 'showProp',
    prop: {
      id: 'placeholder-fit-prop',
      name: 'Placeholder corner',
      elements: [videoOf('fit-prop-video', proppedId)],
    },
  });
  await dispatch(win, {
    type: 'showLogo',
    prop: {
      id: 'placeholder-fit-logo',
      name: 'Placeholder logo',
      elements: [videoOf('fit-logo-video', markedId)],
    },
  });
  await expect(rows(win)).toHaveCount(7);
  for (const which of [
    'background',
    `slide:${oneId}`,
    `slide:${twoId}`,
    `props:placeholder-fit-prop:${proppedId}`,
    `logo:${markedId}`,
    'pip',
    'audio',
  ])
    await expect(row(win, which).getByRole('slider')).toBeVisible({ timeout: 15_000 });
  // The two-hour background paused: its row says so, its time left in hours, minutes and seconds (counted up to
  // whole seconds, as a countdown is: paused within its first second, -2:00:00).
  await row(win, 'background').getByRole('button', { name: 'Pause' }).click();
  const bg = row(win, 'background');
  await expect(bg.getByTestId('time-bar-paused')).toBeVisible();
  await expect(bg.getByTestId('time-bar-left')).toHaveText(/^-[12]:\d\d:\d\d$/);

  // Pro Mode: Next and Back where they were, in view; every row whole in the live column (scrolled to).
  expect((await next.boundingBox())?.y, 'Next where it was').toBe(nextAt);
  expect((await back.boundingBox())?.y, 'Back where it was').toBe(backAt);
  const shown = await next.boundingBox();
  expect((shown?.y ?? 9999) + (shown?.height ?? 0), 'Next in view').toBeLessThanOrEqual(645);
  await rowsFit(win, rows(win), 1024, 'Pro Mode');
  await expectNoSeriousA11yIssues(win, 'every kind playing at 1024 × 645, Pro Mode');

  // A phone and a tablet: every row, its Play or Pause and its bar 44 px tall at least, nothing sideways, axe.
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    for (const size of [
      { width: 375, height: 812, layout: 'phone' },
      { width: 768, height: 1024, layout: 'wide' },
    ]) {
      await p.setViewportSize({ width: size.width, height: size.height });
      // The remote lays itself out for its new size a moment later (its media queries' change), drawing its rows anew:
      // they are measured once it has.
      await expect(p.getByTestId('remote')).toHaveAttribute('data-layout', size.layout);
      const phoneRows = p.getByTestId('remote-time-bar-row');
      await expect(phoneRows).toHaveCount(7);
      await rowsFit(p, phoneRows, size.width, `the remote at ${String(size.width)} × ${String(size.height)}`);
      for (const r of await phoneRows.all())
        for (const target of [r.getByRole('button'), r.getByRole('slider')]) {
          const box = await target.boundingBox();
          expect(box?.height ?? 0, 'a finger’s size').toBeGreaterThanOrEqual(44);
          expect(box?.width ?? 0, 'a finger’s size').toBeGreaterThanOrEqual(44);
        }
      await expectNoSeriousA11yIssues(p, `every kind playing on the remote at ${String(size.width)} wide`);
    }
  } finally {
    await phone.close();
  }

  // Simple Mode: the same seven, each whole under its LIVE picture, its big buttons in view.
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(rows(win)).toHaveCount(7);
  await rowsFit(win, rows(win), 1024, 'Simple Mode');
  const buttons = await win.getByTestId('simple-buttons').boundingBox();
  expect((buttons?.y ?? 9999) + (buttons?.height ?? 0), 'the big buttons in view').toBeLessThanOrEqual(645);
  await expectNoSeriousA11yIssues(win, 'every kind playing at 1024 × 645, Simple Mode');
  await app.close();
});

test('in Simple Mode, a phone’s Pause of a sound put up from its Media is refused in words (Simple Mode’s window could never play it on), and its Play still plays on one paused before', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-time-bar-phone-sound-'));
  const [first = '', second = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder first tone.wav'), { seconds: 60, hz: 440 }),
    makeTestTone(join(dir, 'Placeholder second tone.wav'), { seconds: 60, hz: 550 }),
  ]);
  const audio = await audioPage(app);
  const heard = (mediaId: string): Copy[] => [
    { name: 'the audio player', page: audio, selector: `audio[data-media-id="${mediaId}"]` },
  ];
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    /** A tone put up from the phone's Media, as a person would (a sound plays over the rest), then the Show tab. */
    const putUp = async (name: string, mediaId: string) => {
      await p.getByTestId('remote-tab-library').click();
      await p.getByTestId('remote-library-media').click();
      await p.getByTestId('remote-media-search').fill(name);
      await p.getByTestId('remote-media-item').filter({ hasText: name }).getByRole('button').first().click();
      await expect.poll(async () => (await snapshot(win)).layers.audio?.mediaId).toBe(mediaId);
      await p.getByTestId('remote-tab-show').click();
    };
    const phoneRow = p.locator('[data-testid="remote-time-bar-row"][data-playing="audio"]');

    // Pro Mode: the first tone up from the phone's Media, paused from its bar there.
    await putUp('Placeholder first tone', first);
    await expect(phoneRow.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
    await phoneRow.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await soundTiming(win)).seek?.paused).toBe(true);

    // Simple Mode: its window shows the bar, paused, with no Play of its own; the phone's Play plays it on.
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(row(win, 'audio').getByTestId('time-bar-paused')).toBeVisible();
    await expect(win.getByTestId('time-bar-play')).toHaveCount(0);
    await phoneRow.getByRole('button', { name: 'Play' }).click();
    await expect.poll(async () => (await soundTiming(win)).seek?.paused).toBeUndefined();
    await inStep(heard(first), () => soundTiming(win), 'played on from the phone in Simple Mode');

    // The second tone, put up from the phone's Media in Simple Mode: its Pause refused in words, and it plays on.
    await putUp('Placeholder second tone', second);
    await expect(phoneRow.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
    const playing = (await soundTiming(win)).seek;
    await phoneRow.getByRole('button', { name: 'Pause' }).click();
    await expect(p.getByText('Simple Mode is on', { exact: false })).toBeVisible();
    expect((await soundTiming(win)).seek).toEqual(playing);
    await inStep(heard(second), () => soundTiming(win), 'still playing after the refused Pause');
  } finally {
    await phone.close();
  }
  await app.close();
});
