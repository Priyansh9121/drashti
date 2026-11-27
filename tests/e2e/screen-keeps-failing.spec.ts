import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  dispatch,
  makeClip,
  notices,
  openNewPlaylist,
  OUT,
  row,
  SCREENS,
  showPicture,
  shown,
  soundPlays,
  wallpaperAndPicture,
} from './hall-looks';
import {
  isBlackLook,
  msWhere,
  poisonKills,
  poisonWindow,
  runsOf,
  sampler,
  screenLook,
  screenState,
  upNow,
  watchdogEvents,
} from './keeps-failing';

/*
 * A hall screen that keeps failing on what is up (x53; the owner's Q60-31 bug hunt, x52's D6a and D6b, his Q60-50 A).
 * Until now a screen whose picture failed each time it drew while a video was up was reloaded once and then left black
 * for good, its sound playing on, Screens saying "showing", nobody told (x52-1120-161434-29576: 67 s on both systems);
 * and a screen whose renderer went down each time it loaded a video was black for about 16 s, then Stopped until Try
 * again. Now, as a video that fails comes off (x46's take-off, Q60-21, Q60-44, Q60-46): a screen that fails again
 * within a minute with the same video up takes it off, with its sound and a notice naming it and the screen, and draws
 * what is left at once; with nothing to blame, the screen is Stopped and said (never "showing" while black), and comes
 * back by itself once it draws again. Generated media and placeholder names only.
 */

/** Hall screens that follow a pretend display, and the test's switch for a picture that fails as it draws. */
const ENV = { ...SCREENS, DRASHTI_TEST_RENDER_ERRORS: '1' };

/** The screen's own id, from its page. */
const screenOf = async (page: Page) =>
  (await page.getByTestId('output-root').getAttribute('data-screen')) ?? '';

/** The fault: the screen's picture fails each time it draws while `mediaId` is up (said again every half second). */
const failWhileUp = (app: ElectronApplication, screenId: string, mediaId: string) =>
  app.evaluate(
    (_electron, { sid, id }) =>
      new Promise<void>((resolve) => {
        // On Main's own turn: no Node timer made inside the call (src/main/e2e-main-evaluate.test.ts).
        setImmediate(() => {
          const g = globalThis as {
            drashtiTestRenderError?: (screenId?: string, whileUp?: string | null) => number;
            x53Fault?: ReturnType<typeof setInterval>;
          };
          g.drashtiTestRenderError?.(sid, id);
          g.x53Fault = setInterval(() => {
            g.drashtiTestRenderError?.(sid, id);
          }, 500);
          resolve();
        });
      }),
    { sid: screenId, id: mediaId },
  );

const faultOff = (app: ElectronApplication) =>
  app.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setImmediate(() => {
          clearInterval((globalThis as { x53Fault?: ReturnType<typeof setInterval> }).x53Fault);
          resolve();
        });
      }),
  );

test('a hall screen whose picture fails each time it draws while a video is up: the video comes off with its sound and a notice naming it and the screen, and the screen draws the Wallpaper within seconds, never left black', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-keeps-failing-draw-'));
  const clip = makeClip(join(dir, 'Placeholder fails as it draws.mp4'), 'h264', 120, 523);
  const { app } = await launchApp(ENV);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = await screenOf(hall.page);
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder fails as it draws', id);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('VIDEO');
    await expect.poll(() => soundPlays(app), { timeout: 20_000, message: 'its sound plays' }).toBe(true);

    const t0 = Date.now();
    await failWhileUp(app, screenId, id);
    const seen = sampler(async () => {
      const [look, up, state] = await Promise.all([
        screenLook(app, screenId),
        upNow(win),
        screenState(win, screenId),
      ]);
      return { look, up: up === id ? 'the video' : up, state };
    });
    const offAfter = await expect
      .poll(() => upNow(win), { timeout: 20_000 })
      .not.toBe(id)
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 5000, 'the screen draws on without the video');
    const samples = await seen.stop();
    await faultOff(app);
    const result = {
      offAfterMs: offAfter,
      blackMs: msWhere(samples, (v) => isBlackLook(v.look)),
      lastLook: samples.at(-1)?.v.look ?? 'none',
      stopped: samples.filter((s) => s.v.state === 'stopped').length,
      soundAfter: await soundPlays(app),
      told: await notices(win),
      runs: runsOf(samples, t0),
      watchdog: (await watchdogEvents(app)).filter((e) => e.includes('output')),
    };
    console.log(`X53 ${process.platform} (draw) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `the video comes off once the screen keeps failing on it: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(result.told).toContainEqual(
      expect.stringMatching(new RegExp(`Placeholder fails as it draws[\\s\\S]*${hall.name}`, 'u')),
    );
    expect(result.lastLook, 'the screen draws the Wallpaper once the video is off').toBe('WALL');
    expect(result.blackMs, 'black only while it fails and loads again, a few seconds').toBeLessThan(8000);
    expect(result.soundAfter, 'the video came off with its sound').toBe(false);
    expect(result.stopped, 'never Stopped: what made it fail is off').toBe(0);
  } finally {
    await app.close();
  }
});

test('a hall screen whose picture fails each time it draws with nothing to blame (a picture up): Stopped within seconds, said by the red notice naming it, never “showing” while black; back by itself once what fails is off', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-keeps-failing-stop-'));
  const { app } = await launchApp(ENV);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = await screenOf(hall.page);
    const pictureId = await wallpaperAndPicture(win, dir);
    await showPicture(win, pictureId);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('BEFORE');

    const t0 = Date.now();
    await failWhileUp(app, screenId, pictureId);
    const seen = sampler(async () => {
      const [look, state] = await Promise.all([screenLook(app, screenId), screenState(win, screenId)]);
      return { look, state };
    });
    const stoppedAfter = await expect
      .poll(() => screenState(win, screenId), { timeout: 20_000 })
      .toBe('stopped')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 4000, 'stopped: said, and never counted as showing');
    const notice = win.getByTestId('screen-stopped-notice');
    const said = (await notice.count()) > 0 ? await notice.first().textContent() : null;
    // What fails comes off by the operator's hand: the screen draws the Wallpaper, and is back by itself.
    await dispatch(win, { type: 'clearAll' });
    const backAfter = await expect
      .poll(() => screenState(win, screenId), { timeout: 15_000 })
      .toBe('showing')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 2000, 'it draws on');
    const samples = await seen.stop();
    await faultOff(app);
    const showingBlack = msWhere(samples, (v) => v.state === 'showing' && isBlackLook(v.look));
    const result = {
      stoppedAfterMs: stoppedAfter,
      backAfterMs: backAfter,
      showingWhileBlackMs: showingBlack,
      said,
      noticeAfter: await notice.count(),
      lastLook: samples.at(-1)?.v.look ?? 'none',
      runs: runsOf(samples, t0),
      watchdog: (await watchdogEvents(app)).filter((e) => e.includes('output')),
    };
    console.log(`X53 ${process.platform} (stop) ${JSON.stringify(result)}`);
    expect(
      stoppedAfter,
      `Stopped once it keeps failing with nothing to take off: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(said ?? '', 'the red notice names the screen').toContain(`“${hall.name}” has stopped`);
    expect(showingBlack, '“showing” while black only until it is given up on, a few seconds').toBeLessThan(
      8000,
    );
    expect(backAfter, 'back by itself once it draws again').toBeGreaterThan(0);
    expect(result.noticeAfter, 'the notice goes once it is back').toBe(0);
    expect(result.lastLook).toBe('WALL');
  } finally {
    await app.close();
  }
});

test('a hall screen whose renderer goes down each time it loads a video: after the second time the video comes off with a notice naming it and the screen, and the screen is back at once on the Wallpaper, never Stopped', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-keeps-failing-crash-'));
  const clip = makeClip(join(dir, 'Placeholder brings the screen down.mp4'), 'h264', 120, 659);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = await screenOf(hall.page);
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder brings the screen down', id);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('VIDEO');

    // From here the screen's page is read by Main (Playwright cannot follow a page that crashed).
    const t0 = Date.now();
    await poisonWindow(app, `screen=${screenId}`, `video[data-media-id="${id}"]`);
    const seen = sampler(async () => {
      const [look, up, state] = await Promise.all([
        screenLook(app, screenId),
        upNow(win),
        screenState(win, screenId),
      ]);
      return { look, up: up === id ? 'the video' : up, state };
    });
    const offAfter = await expect
      .poll(() => upNow(win), { timeout: 15_000 })
      .not.toBe(id)
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const wallAfter = await expect
      .poll(() => screenLook(app, screenId), { timeout: 15_000 })
      .toBe('WALL')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 3000, 'it draws on');
    const samples = await seen.stop();
    const events = await watchdogEvents(app);
    const result = {
      kills: await poisonKills(app, `screen=${screenId}`),
      offAfterMs: offAfter,
      wallAfterMs: wallAfter,
      stopped: samples.filter((s) => s.v.state === 'stopped').length,
      told: await notices(win),
      runs: runsOf(samples, t0),
      watchdog: events.filter((e) => e.includes('output')),
    };
    console.log(`X53 ${process.platform} (crash) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `the video comes off once the screen keeps going down on it: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(result.told).toContainEqual(
      expect.stringMatching(new RegExp(`Placeholder brings the screen down[\\s\\S]*${hall.name}`, 'u')),
    );
    expect(wallAfter, 'back at once on the Wallpaper').toBeGreaterThan(0);
    expect(result.kills, 'down twice, then never again').toBeLessThanOrEqual(3);
    expect(result.stopped, 'never Stopped').toBe(0);
    expect(
      events.some((e) => e.includes(' gave-up output')),
      'never given up',
    ).toBe(false);
  } finally {
    await app.close();
  }
});

/** A presentation of one slide with this video over the whole slide, playing round (x46's way). */
async function slideWithVideo(win: Page, dir: string, mediaId: string, name: string): Promise<string> {
  const words = join(dir, `${name}.txt`);
  writeFileSync(words, '[Verse]\nPlaceholder words over a video\n');
  const [presentationId = ''] = await importAndGetIds(win, [words]);
  await win.evaluate(
    async ({ presentationId, mediaId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(presentationId);
      if (!opened.ok) throw new Error(opened.message);
      const slide = opened.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('The presentation has no slide.');
      slide.elements = [
        {
          id: 'placeholder-slide-video',
          kind: 'video',
          mediaId,
          frame: { x: 0, y: 0, width: 1920, height: 1080 },
          fit: 'fill',
          loop: true,
        },
      ];
      const saved = await d.library.saveSlides(presentationId, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { presentationId, mediaId },
  );
  return presentationId;
}

// Q60-52 A (the owner's, x53's question): a video on a slide that brings a page down. x46's take-off pauses it where it
// is (Q60-21), but the page still loads it: after the third time within a minute its slide comes off as Clear slide
// takes it, said by its name and where (Back or Oops can bring the slide back).
test('a video on a slide that brings a hall screen down each time it loads: paused after the second time, its slide comes off after the third with a notice naming it and the screen; the screen back at once, never Stopped', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-keeps-failing-slide-'));
  const clip = makeClip(join(dir, 'Placeholder slide video brings it down.mp4'), 'h264', 120, 587);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const screenId = await screenOf(hall.page);
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const presentationId = await slideWithVideo(win, dir, id, 'Placeholder slide over a video');
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
    const onSlide = `[data-layer="slide"] video[data-media-id="${id}"]`;
    await expect
      .poll(
        () =>
          hall.page.evaluate(
            (sel) => !(document.querySelector<HTMLVideoElement>(sel)?.paused ?? true),
            onSlide,
          ),
        { timeout: 30_000, message: 'the slide’s video plays on the hall' },
      )
      .toBe(true);

    // From here the screen's page is read by Main (Playwright cannot follow a page that crashed).
    const t0 = Date.now();
    await poisonWindow(app, `screen=${screenId}`, onSlide);
    const slideUp = () =>
      win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide !== null,
      );
    const offAfter = await expect
      .poll(slideUp, { timeout: 20_000 })
      .toBe(false)
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    const backAfter = await expect
      .poll(() => screenLook(app, screenId), { timeout: 15_000 })
      .toBe('WALL')
      .then(
        () => Date.now() - t0,
        () => -1,
      );
    await letTimePass(win, 3000, 'it draws on');
    const events = await watchdogEvents(app);
    const result = {
      kills: await poisonKills(app, `screen=${screenId}`),
      slideOffAfterMs: offAfter,
      wallAfterMs: backAfter,
      state: await screenState(win, screenId),
      told: await notices(win),
      watchdog: events.filter((e) => e.includes('output')),
    };
    console.log(`X53 ${process.platform} (slide) ${JSON.stringify(result)}`);
    expect(
      offAfter,
      `its slide comes off once the paused video still brings the screen down: ${JSON.stringify(result)}`,
    ).toBeGreaterThan(0);
    expect(result.told).toContainEqual(
      expect.stringMatching(
        new RegExp(`Placeholder slide video brings it down[\\s\\S]*${hall.name}[\\s\\S]*slide came off`, 'u'),
      ),
    );
    expect(backAfter, 'the screen back at once on the Wallpaper').toBeGreaterThan(0);
    expect(result.kills, 'down three times, then never again').toBeLessThanOrEqual(4);
    expect(result.state, 'never Stopped').toBe('showing');
    expect(
      events.some((e) => e.includes(' gave-up output')),
      'never given up',
    ).toBe(false);
  } finally {
    await app.close();
  }
});
