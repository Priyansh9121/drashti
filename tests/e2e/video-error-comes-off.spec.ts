import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  backgroundUp,
  dispatch,
  failVideo,
  installLooks,
  LIVE,
  makeClip,
  notices,
  openNewPlaylist,
  OUT,
  pictureUp,
  row,
  SCREENS,
  shown,
  soundPlays,
  wallpaperAndPicture,
  watch,
} from './hall-looks';
import { testFfmpeg } from './stream-helpers';

/*
 * A video whose element fails on a screen (Q60-31, the owner's own bug: "the video where it doesnt play in audience
 * screen"; his video, an ordinary H.264 file, played on his laptop and not on the mandir's Mac, its sound playing while
 * LIVE showed black or the Wallpaper). x46's hunt (CI x46-1120-112649-63694) showed what Drashti did on every computer
 * when a screen's video element fails, as that computer's decoder raises an error, or a cut or damaged file does: the
 * hall went BLACK at once (the picture before dropped), its sound playing on, never taken off, nobody told (only LIVE's
 * own mark when LIVE's element failed too; with the hall's alone, LIVE showed the video playing). As x36's reaction to a
 * picture that cannot be drawn: it comes off at once with its sound, the hall never black, a notice naming the file
 * and the screen, and the log naming the error's kind and the screen. Generated media only, placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

/** Everything this Drashti wrote to its log (logs/drashti.log, then drashti.1.log… as it fills). */
function logOf(userData: string): string {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/** Bytes from 40 % to 60 % of the file written over with made-up noise (always the same), as a damaged disk would. */
function damageMiddle(path: string): string {
  const size = statSync(path).size;
  const from = Math.floor(size * 0.4);
  const junk = Buffer.alloc(Math.floor(size * 0.6) - from);
  let x = 12345;
  for (let i = 0; i < junk.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    junk[i] = x & 0xff;
  }
  const fd = openSync(path, 'r+');
  try {
    writeSync(fd, junk, 0, junk.length, from);
  } finally {
    closeSync(fd);
  }
  return path;
}

test('a video whose element fails while it plays on a hall screen (as that computer’s decoder raises an error), LIVE still playing it: it comes off at once with its sound, the hall never black, a notice names the file and the screen, and the log the error’s kind and the screen', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-error-'));
  const clip = makeClip(join(dir, 'Placeholder fails on the hall.mp4'), 'h264', 20, 300);
  const { app, userData } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    expect(hall.name, 'the audience screen’s name').not.toBe('');
    const beforeId = await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder video error', id);
    await installLooks(hall.page, OUT);
    await pictureUp(win, hall.page, beforeId);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000, message: 'it plays' }).toBe('VIDEO');
    await letTimePass(win, 1000, 'it plays a moment before the hall’s decoder fails');
    expect(await failVideo(hall.page, id), 'the hall’s video element').toBe(true);
    // Only the hall's element failed: LIVE's plays on. Main must hear it from the hall.
    const w = await watch(app, win, hall.page, id, 6_000, false);
    expect(w.off, `it came off within 6 s of the error: ${w.looks.join(' | ')}`).toBe(true);
    expect(w.blackWithSound, `never black while its sound played: ${w.looks.join(' | ')}`).toBe(0);
    expect(w.black, `never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
    await expect
      .poll(() => soundPlays(app), { timeout: 5_000, message: 'its sound stopped with it' })
      .toBe(false);
    // Off: the Wallpaper on the hall and on LIVE alike (LIVE never says it plays while the hall does not).
    await expect.poll(() => shown(hall.page, OUT), { timeout: 10_000 }).toBe('WALL');
    await expect.poll(() => shown(win, LIVE), { timeout: 10_000 }).toBe('WALL');
    // Said plainly: the file and the screen.
    await expect
      .poll(() => notices(win), { timeout: 10_000, message: 'a notice names the file and the screen' })
      .toContainEqual(
        expect.stringMatching(new RegExp(`Placeholder fails on the hall[\\s\\S]*${hall.name}`, 'u')),
      );
    // Logged: the error's kind and the screen.
    await expect
      .poll(() => logOf(userData), {
        timeout: 10_000,
        message: 'the log names the error’s kind and the screen',
      })
      .toMatch(new RegExp(`could not play on the screen “${hall.name}” \\([^)]+\\)`, 'u'));
  } finally {
    await app.close();
  }
});

test('a video cut with no movie box (a copy or a download stopped part-way), put up over a picture: the hall keeps the picture, it comes off with a notice naming it and the screen, and no sound plays', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-cut-'));
  const clip = makeClip(join(dir, 'Placeholder cut copy.mp4'), 'h264-moov-at-end', 12, 330);
  truncateSync(clip, Math.floor(statSync(clip).size * 0.6));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    expect(id, 'a cut file still comes in (FFmpeg reads nothing in it; its header is not sure)').not.toBe('');
    const { item } = await openNewPlaylist(win, 'Placeholder cut copy', id);
    await pictureUp(win, hall.page, beforeId);
    await row(win, item).click();
    const w = await watch(app, win, hall.page, id, 8_000, false);
    expect(w.off, `it came off: ${w.looks.join(' | ')}`).toBe(true);
    expect(w.black, `the hall never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
    expect(
      w.looks.filter((l) => l.includes('+sound')),
      `no sound for a file that cannot play: ${w.looks.join(' | ')}`,
    ).toEqual([]);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 10_000 }).toBe('WALL');
    await expect
      .poll(() => notices(win), { timeout: 10_000, message: 'a notice names the file and the screen' })
      .toContainEqual(expect.stringMatching(new RegExp(`Placeholder cut copy[\\s\\S]*${hall.name}`, 'u')));
  } finally {
    await app.close();
  }
});

test('a video that stops part-way (cut half-way, or damaged in its middle): at its failure it comes off with its sound, the hall never black, and a notice names it and the screen', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-part-'));
  const half = makeClip(join(dir, 'Placeholder cut half-way.mp4'), 'h264', 12, 392);
  truncateSync(half, Math.floor(statSync(half).size * 0.5));
  const damaged = damageMiddle(makeClip(join(dir, 'Placeholder damaged middle.mp4'), 'h264', 12, 494));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    for (const [file, name] of [
      [half, 'Placeholder cut half-way'],
      [damaged, 'Placeholder damaged middle'],
    ] as const) {
      const [id = ''] = await importAndGetIds(win, [file]);
      const { item } = await openNewPlaylist(win, name, id);
      await pictureUp(win, hall.page, beforeId);
      await row(win, item).click();
      await expect
        .poll(() => shown(hall.page, OUT), { timeout: 30_000, message: `${name}: it plays` })
        .toBe('VIDEO');
      // Until it is off, or the engine's own end of its 12 s.
      const w = await watch(app, win, hall.page, id, 14_000, false);
      expect(w.blackWithSound, `${name}: never black while its sound played: ${w.looks.join(' | ')}`).toBe(0);
      expect(w.black, `${name}: never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
      // Off at its failure (about 4-6 s in), not at the engine's own end of its 12 s.
      const offAt = Number(/^(\d+)ms/u.exec(w.looks.find((l) => l.includes('(bg ')) ?? '')?.[1] ?? NaN);
      expect(
        offAt,
        `${name}: it came off at its failure, well before its 12 s: ${w.looks.join(' | ')}`,
      ).toBeLessThan(10_000);
      await expect
        .poll(() => soundPlays(app), { timeout: 5_000, message: `${name}: its sound stopped` })
        .toBe(false);
      await expect
        .poll(() => notices(win), { timeout: 10_000, message: `${name}: a notice names it and the screen` })
        .toContainEqual(expect.stringMatching(new RegExp(`${name}[\\s\\S]*${hall.name}`, 'u')));
      await dispatch(win, { type: 'clearAll' });
    }
  } finally {
    await app.close();
  }
});

test('a video whose first frame does not come within 10 s (each read of its file 15 s late, as from a stalled disk or decoder): the hall keeps the Wallpaper until then, never black, and then it comes off as a video that cannot play: a notice names it and the screen, the log says no picture within 10 s', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-no-first-frame-'));
  const clip = makeClip(join(dir, 'Placeholder never draws.mp4'), 'h264', 30, 350);
  // Every read of a media file comes 15 s late (the Wallpaper's picture too): the video's first frame cannot come in 10 s.
  const { app, userData } = await launchApp({ ...SCREENS, DRASHTI_TEST_MEDIA_DELAY_MS: '15000' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    expect(hall.name, 'the audience screen’s name').not.toBe('');
    await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder no first frame', id);
    await expect
      .poll(() => shown(hall.page, OUT), { timeout: 90_000, message: 'the Wallpaper, its picture 15 s late' })
      .toBe('WALL');
    const putUp = Date.now();
    await row(win, item).click();
    await expect.poll(() => backgroundUp(win), { timeout: 5_000, message: 'it is up' }).toBe(id);
    const w = await watch(app, win, hall.page, id, 30_000, false);
    const offMs = Date.now() - putUp;
    expect(w.off, `it came off, as a video that cannot play: ${w.looks.join(' | ')}`).toBe(true);
    expect(offMs, `it came off soon after 10 s with no first frame: ${w.looks.join(' | ')}`).toBeLessThan(
      18_000,
    );
    expect(offMs, `not before its 10 s: ${w.looks.join(' | ')}`).toBeGreaterThan(9_000);
    expect(
      w.looks.filter((l) => !l.includes('H:WALL')),
      'the hall kept the Wallpaper until it came off, never black',
    ).toEqual([]);
    await expect
      .poll(() => soundPlays(app), { timeout: 5_000, message: 'no sound plays once it is off' })
      .toBe(false);
    await expect
      .poll(() => notices(win), { timeout: 10_000, message: 'a notice names the file and the screen' })
      .toContainEqual(expect.stringMatching(new RegExp(`Placeholder never draws[\\s\\S]*${hall.name}`, 'u')));
    // The kind, then what the start watch saw (6fb24720): nothing decoded, so no progress at all.
    await expect
      .poll(() => logOf(userData), { timeout: 10_000, message: 'the log says no picture within 10 s' })
      .toMatch(
        new RegExp(
          `could not play on the screen “${hall.name}” \\(no picture within 10 s: \\d+ looks over [\\d.]+ s, the last progress [\\d.]+ s ago; [^\\n]*, 0 decoded,`,
          'u',
        ),
      );
  } finally {
    await app.close();
  }
});

/** A presentation of one slide holding the video over it all: a slide's own video, with its sound. */
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

/** The engine's word on that file on the slide and in the box: paused on the slide, the box up. */
async function slideAndBox(win: Page, mediaId: string): Promise<{ slidePaused: boolean; box: boolean }> {
  const s = (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;
  return {
    slidePaused: s.layers.slide?.seeks?.[mediaId]?.paused === true,
    box: s.layers.pip !== null,
  };
}

/** Whether that file's sound plays in the audio player now. */
async function itsSound(app: ElectronApplication, mediaId: string): Promise<boolean> {
  const audio = app.windows().find((w) => w.url().includes('audio.html'));
  if (!audio) return false;
  return audio.evaluate(
    (id) =>
      [...document.querySelectorAll<HTMLMediaElement>(`audio[data-media-id="${id}"]`)].some(
        (e) => !e.paused && e.currentTime > 0.05,
      ),
    mediaId,
  );
}

const PLACE = {
  corner: 'top-right',
  x: 0,
  y: 0,
  size: 'large',
  border: false,
  rounded: false,
  motion: 'fade',
};

test('a slide’s video and the picture-in-picture box’s video that cannot play (its decoder raising an error; a cut file): the slide’s waits paused where it is with its sound, the slide staying; the box comes off; a notice names each and the screen', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-slide-box-error-'));
  const onSlide = makeClip(join(dir, 'Placeholder slide video.mp4'), 'h264', 30, 300);
  const inBox = makeClip(join(dir, 'Placeholder box video.mp4'), 'h264', 30, 360);
  const cutSlide = makeClip(join(dir, 'Placeholder cut slide video.mp4'), 'h264-moov-at-end', 12, 420);
  truncateSync(cutSlide, Math.floor(statSync(cutSlide).size * 0.6));
  const cutBox = makeClip(join(dir, 'Placeholder cut box video.mp4'), 'h264-moov-at-end', 12, 480);
  truncateSync(cutBox, Math.floor(statSync(cutBox).size * 0.6));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const [onSlideId = '', inBoxId = '', cutSlideId = '', cutBoxId = ''] = await importAndGetIds(win, [
      onSlide,
      inBox,
      cutSlide,
      cutBox,
    ]);
    const SLIDE = (id: string) => `[data-layer="slide"] video[data-media-id="${id}"]`;
    const BOX = (id: string) => `[data-pip-picture="media"] video[data-media-id="${id}"]`;
    const raise = (selector: string) =>
      hall.page.evaluate((sel) => {
        const v = document.querySelector<HTMLVideoElement>(sel);
        if (!v) return false;
        v.dispatchEvent(new Event('error'));
        return true;
      }, selector);
    const told = (name: string) =>
      expect
        .poll(() => notices(win), { timeout: 15_000, message: `${name}: a notice names it and the screen` })
        .toContainEqual(expect.stringMatching(new RegExp(`${name}[\\s\\S]*${hall.name}`, 'u')));

    // 1. A slide's video playing, its sound with it: its element fails on the hall.
    const p1 = await slideWithVideo(win, dir, onSlideId, 'Placeholder slide one');
    await dispatch(win, { type: 'goLive', presentationId: p1, slideIndex: 0 });
    await expect
      .poll(
        () =>
          hall.page.evaluate(
            (sel) => !(document.querySelector<HTMLVideoElement>(sel)?.paused ?? true),
            SLIDE(onSlideId),
          ),
        {
          timeout: 30_000,
          message: 'the slide’s video plays on the hall',
        },
      )
      .toBe(true);
    await expect
      .poll(() => itsSound(app, onSlideId), { timeout: 15_000, message: 'its sound plays' })
      .toBe(true);
    expect(await raise(SLIDE(onSlideId)), 'the slide’s video element').toBe(true);
    await expect
      .poll(async () => (await slideAndBox(win, onSlideId)).slidePaused, {
        timeout: 10_000,
        message: 'paused on the slide',
      })
      .toBe(true);
    await expect
      .poll(() => itsSound(app, onSlideId), { timeout: 5_000, message: 'its sound stopped' })
      .toBe(false);
    await told('Placeholder slide video');

    // 2. A slide's video whose file is cut (no movie box): never plays; said, and paused.
    await dispatch(win, { type: 'clearAll' });
    const p2 = await slideWithVideo(win, dir, cutSlideId, 'Placeholder slide two');
    await dispatch(win, { type: 'goLive', presentationId: p2, slideIndex: 0 });
    await expect
      .poll(async () => (await slideAndBox(win, cutSlideId)).slidePaused, {
        timeout: 15_000,
        message: 'the cut one paused on the slide',
      })
      .toBe(true);
    await told('Placeholder cut slide video');

    // 3. The box's video playing: its element fails on the hall. The box comes off.
    await dispatch(win, { type: 'clearAll' });
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: inBoxId }, place: PLACE });
    await expect
      .poll(
        () =>
          hall.page.evaluate(
            (sel) => !(document.querySelector<HTMLVideoElement>(sel)?.paused ?? true),
            BOX(inBoxId),
          ),
        {
          timeout: 30_000,
          message: 'the box’s video plays on the hall',
        },
      )
      .toBe(true);
    expect(await raise(BOX(inBoxId)), 'the box’s video element').toBe(true);
    await expect
      .poll(async () => (await slideAndBox(win, inBoxId)).box, {
        timeout: 10_000,
        message: 'the box came off',
      })
      .toBe(false);
    await told('Placeholder box video');

    // 4. The box's video whose file is cut: the box comes off.
    await dispatch(win, { type: 'clearAll' });
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: cutBoxId }, place: PLACE });
    await expect
      .poll(async () => (await slideAndBox(win, cutBoxId)).box, {
        timeout: 15_000,
        message: 'the cut one’s box came off',
      })
      .toBe(false);
    await told('Placeholder cut box video');
  } finally {
    await app.close();
  }
});

test('a slide’s video waiting paused when its element fails on the hall (alpha.23): nothing comes off and the hall is not changed, but a notice names it and the screen and says what to try, LIVE names the screen under its picture while it stays up, and the log has it', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-slide-waiting-error-'));
  const clip = makeClip(join(dir, 'Placeholder waiting video.mp4'), 'h264', 30, 300);
  const { app, userData } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    expect(hall.name, 'the audience screen’s name').not.toBe('');
    const [id = ''] = await importAndGetIds(win, [clip]);
    const SLIDE = `[data-layer="slide"] video[data-media-id="${id}"]`;
    const presentationId = await slideWithVideo(win, dir, id, 'Placeholder slide waiting');
    await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
    await expect
      .poll(
        () =>
          hall.page.evaluate(
            (sel) => !(document.querySelector<HTMLVideoElement>(sel)?.paused ?? true),
            SLIDE,
          ),
        { timeout: 30_000, message: 'the slide’s video plays on the hall' },
      )
      .toBe(true);
    // Paused on its time bar: up, not playing (as one waiting for its click is).
    expect((await dispatch(win, { type: 'pausePlaying', playing: { layer: 'slide', mediaId: id } })).ok).toBe(
      true,
    );
    await expect
      .poll(
        () =>
          hall.page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.paused ?? false, SLIDE),
        { timeout: 10_000, message: 'paused on the hall' },
      )
      .toBe(true);
    const failed = await hall.page.evaluate((sel) => {
      const v = document.querySelector<HTMLVideoElement>(sel);
      if (!v) return false;
      v.dispatchEvent(new Event('error'));
      return true;
    }, SLIDE);
    expect(failed, 'the hall’s slide video element').toBe(true);
    // Said plainly: the file, the screen, and what to try.
    await expect
      .poll(() => notices(win), { timeout: 15_000, message: 'a notice names the file and the screen' })
      .toContainEqual(
        expect.stringMatching(
          new RegExp(
            `Placeholder waiting video[^ ]* could not play on the screen “${hall.name}”\\. It is still up but not playing[\\s\\S]*Put something else up`,
            'u',
          ),
        ),
      );
    // LIVE says it under its picture, while the slide stays up.
    await expect(win.getByTestId('live-not-on-screens')).toContainText(
      `Not on the screen “${hall.name}”: “Placeholder waiting video`,
    );
    // Logged: the error's kind, the screen, and that nothing came off.
    await expect
      .poll(() => logOf(userData), { timeout: 10_000, message: 'the log names the screen and the file' })
      .toMatch(
        new RegExp(
          `could not play on the screen “${hall.name}” \\([^)]+\\): ${id}; left up, not playing \\(paused, waiting for its click or at its end\\), so nothing came off`,
          'u',
        ),
      );
    // Nothing came off: the slide is up with its video paused there, as the operator left it.
    expect(await slideAndBox(win, id), 'the slide and its paused video stay').toEqual({
      slidePaused: true,
      box: false,
    });
    // Off: LIVE says nothing any more.
    await dispatch(win, { type: 'clearAll' });
    await expect(win.getByTestId('live-not-on-screens')).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await app.close();
  }
});
