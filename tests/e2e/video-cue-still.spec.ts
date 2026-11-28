import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  openAllSections,
  operatorPage,
  operatorReady,
} from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';
import { dispatch, snapshot } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';
import { CI_WINDOW, liveColumnToTop, sizeOperatorWindow } from './window-size';

/*
 * The cued video's card and the live zoom's buttons never move LIVE's picture or Next, Back and Oops (alpha.24, lead 2's
 * cuestill; the joined-tree hands-on's row 7, a25 list item 27). Until alpha.24, in Pro Mode, Cue brought the card in
 * above the LIVE picture, so the picture, Next, Back and Oops jumped some 66 px down until Go, right where the
 * operator's hand is; and in Pro and Simple Mode a picture going up brought + / − / Reset in between the picture and
 * Next and Back, pushing them 36 px. Now both sit under Next and Back (under Oops in Pro Mode) and the time bars, so
 * nothing above them moves at any frame as either comes or goes, at CI's 1024 × 645 and at 1410 × 900, the bars' Pause
 * neither; the card's Go and Cancel are the keyboard's next stops after Oops (the bars' own first while something
 * plays); and Go stays in sight at 1024 × 645 with a video's bar up and every section open. Placeholder words and
 * generated media only.
 */

interface StillWatch {
  cueStillWatch?: (stop?: boolean) => { looks: number; moved: string[] };
}

const OWNERS_WINDOW = { width: 1410, height: 900 } as const;
const SIZES = [CI_WINDOW, OWNERS_WINDOW] as const;

/** What must never move: the LIVE picture, Back, Next and (Pro Mode's) Oops. */
const stillOf = (mode: 'pro' | 'simple') =>
  [
    '[data-testid="live-preview"]',
    '[data-testid="show-back"]',
    '[data-testid="show-next"]',
    ...(mode === 'pro' ? ['[data-testid="show-oops"]'] : []),
  ].join(', ');

const sizeName = (size: { width: number; height: number }) =>
  `${String(size.width)} × ${String(size.height)}`;

/** The placeholder presentation's first slide up, then its second, as in a show: Back and Oops can act. */
const slidesUp = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [p] = await d.library.listPresentations();
    if (!p) throw new Error('no placeholder presentation');
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 0 });
    await d.engine.dispatch({ type: 'goLive', presentationId: p.id, slideIndex: 1 });
  });

/** Where each still part is now, to the hundredth of a pixel, named by its test id and its place in the page. */
const stillParts = (win: Page, selector: string) =>
  win.evaluate((selector) => {
    const out: string[] = [];
    document.querySelectorAll(selector).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const id = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
      out.push(
        `${String(i)} ${id}: ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`,
      );
    });
    return out;
  }, selector);

/** The still parts once the window has settled at its size and mode: the same at two looks a second apart. */
async function settledStill(win: Page, selector: string, where: string): Promise<string[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const now = await stillParts(win, selector);
        const same = now.length > 0 && JSON.stringify(now) === JSON.stringify(last);
        last = now;
        return same;
      },
      { message: `${where}: the window settles`, intervals: [1000] },
    )
    .toBe(true);
  return last;
}

/**
 * Watch the still parts at every frame (and every 16 ms between) from now until `stopWatching`: each part not exactly
 * where it was, or gone, with where it went and whether the LIVE block stood then (the first 20).
 */
const startWatching = (win: Page, selector: string) =>
  win.evaluate((selector) => {
    const parts = [...document.querySelectorAll(selector)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const at = (el: Element) => {
      if (!el.isConnected) return 'gone';
      const r = el.getBoundingClientRect();
      return `${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}×${r.height.toFixed(2)}`;
    };
    const first = parts.map(at);
    const moved: string[] = [];
    let looks = 0;
    const look = () => {
      looks += 1;
      const stands = document.querySelector('[data-testid="live-column"]')?.getAttribute('data-still') ?? '?';
      parts.forEach((el, i) => {
        const now = at(el);
        const was = first[i] ?? '';
        const line = `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()} #${String(i)}: ${was} -> ${now} (still ${stands})`;
        if (now !== was && moved.length < 20 && !moved.includes(line)) moved.push(line);
      });
    };
    let going = true;
    const frame = () => {
      if (!going) return;
      look();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const timer = setInterval(look, 16);
    (globalThis as StillWatch).cueStillWatch = (stop = true) => {
      if (stop) {
        going = false;
        clearInterval(timer);
        look();
      }
      return { looks, moved };
    };
    return parts.length;
  }, selector);

const stopWatching = (win: Page) =>
  win.evaluate(() => {
    const stop = (globalThis as StillWatch).cueStillWatch;
    if (!stop) throw new Error('not watching');
    return stop();
  });

/** Keep watching until this DOM state has supplied more than ten fresh samples, within the normal expect bound. */
async function sampleFrames(win: Page, where: string): Promise<void> {
  const samples = () =>
    win.evaluate(() => {
      const read = (globalThis as StillWatch).cueStillWatch;
      if (!read) throw new Error('not watching');
      return read(false).looks;
    });
  const before = await samples();
  await expect
    .poll(samples, { message: `${where}: more than ten fresh samples` })
    .toBeGreaterThan(before + 10);
}

/**
 * Diagnostics only (no check reads them): the LIVE column's parts at a step, attached at the end. Whether the LIVE
 * block stands, its scroller's room, and the boxes of the block, the picture, Next and Back, Oops, the card, its Go,
 * the zoom buttons and the time bars; and the lines LIVE has (its section's children), so a move from one is named.
 */
const geometry = (win: Page, step: string) =>
  win.evaluate((step) => {
    const box = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        x: Number(r.x.toFixed(2)),
        y: Number(r.y.toFixed(2)),
        w: Number(r.width.toFixed(2)),
        h: Number(r.height.toFixed(2)),
      };
    };
    const scroll = document.querySelector<HTMLElement>('[data-testid="live-scroll"]');
    const rest = document.querySelector<HTMLElement>('[data-testid="live-rest"]');
    const section = document.querySelector('section[aria-labelledby="live-preview-title"]');
    return {
      step,
      window: [innerWidth, innerHeight],
      still: document.querySelector('[data-testid="live-column"]')?.getAttribute('data-still') ?? null,
      scroll: scroll
        ? {
            client: scroll.clientHeight,
            height: scroll.scrollHeight,
            top: scroll.scrollTop,
            bar: scroll.offsetWidth - scroll.clientWidth,
          }
        : null,
      rest: rest ? { client: rest.clientHeight, top: rest.scrollTop } : null,
      block: box('[data-testid="live-still"]'),
      preview: box('[data-testid="live-preview"]'),
      nextBack: box('[role="group"][aria-label="Next and Back"]'),
      oops: box('[data-testid="show-oops"]'),
      cue: box('[data-testid="video-cue"]'),
      go: box('button[aria-label="Go cued video"]'),
      zoom: box('[data-testid="live-zoom"]'),
      bars: box('[data-testid="time-bars"]'),
      lines: section
        ? [...section.children].map((el) => el.getAttribute('data-testid') ?? el.tagName.toLowerCase())
        : [],
    };
  }, step);

type Geometry = Awaited<ReturnType<typeof geometry>>;

async function attachGeometry(rows: Geometry[]): Promise<void> {
  await test.info().attach('cuestill-geometry.json', {
    body: Buffer.from(JSON.stringify(rows, null, 1)),
    contentType: 'application/json',
  });
}

const goButton = (win: Page) => win.getByRole('button', { name: 'Go cued video', exact: true });
const cancelButton = (win: Page) => win.getByRole('button', { name: 'Cancel video cue', exact: true });
const liveColumn = (win: Page) => win.getByRole('complementary', { name: 'Live', exact: true });

/** The background's file as the engine has it. */
const backgroundId = async (win: Page) => {
  const bg = (await snapshot(win)).layers.background;
  return bg?.kind === 'media' ? bg.mediaId : null;
};

test('Pro Mode at 1024 × 645 and 1410 × 900: a video cued, waiting, gone with Go, and cued and cancelled: LIVE’s picture, Back, Next and Oops never move, at any frame', async () => {
  test.setTimeout(180_000);
  const { app, win, ids } = await setupVideoCue();
  const rows: Geometry[] = [];
  try {
    await slidesUp(win);
    await expect(win.getByTestId('show-oops')).toBeEnabled();
    const selector = stillOf('pro');
    for (const [i, size] of SIZES.entries()) {
      const where = `Pro Mode at ${sizeName(size)}`;
      const id = ids[i % 2] ?? '';
      const other = ids[(i + 1) % 2] ?? '';
      await sizeOperatorWindow(app, win, size);
      await liveColumnToTop(liveColumn(win));
      const before = await settledStill(win, selector, where);
      for (const part of ['live-preview', 'show-back', 'show-next', 'show-oops'])
        expect(
          before.some((p) => p.includes(` ${part}: `)),
          `${where}: ${part} is there`,
        ).toBe(true);
      rows.push(await geometry(win, `${where}: before the cue`));

      // Cued: the card comes; it waits for every page's first frame; Go: it goes, the video on the screens.
      expect(await startWatching(win, selector)).toBe(before.length);
      expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
      await expect(win.getByTestId('video-cue')).toBeVisible();
      rows.push(await geometry(win, `${where}: cued`));
      await cueReady(win);
      await expect(goButton(win)).toBeEnabled();
      await letTimePass(win, 500, 'the cue waits for its Go');
      rows.push(await geometry(win, `${where}: cue ready`));
      await goButton(win).click();
      await expect(win.getByTestId('video-cue')).toHaveCount(0);
      await expect.poll(() => backgroundId(win)).toBe(id);
      await letTimePass(win, 1000, 'a second of frames after Go');
      rows.push(await geometry(win, `${where}: after Go`));
      const cued = await stopWatching(win);
      expect(cued.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
      expect(cued.moved, `${where}: what moved as the card came, waited and went with Go`).toEqual([]);
      expect(await stillParts(win, selector), `${where}: after Go`).toEqual(before);

      // Cued again while the video plays, then Cancel: nothing moves either, the time bar's Pause too (the card comes
      // under the time bars). The video put up again going round, so its end (8 s) never swaps Pause for Play here.
      const looping = await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fill', loop: true },
      });
      expect(looping.ok).toBe(true);
      await expect(win.getByTestId('time-bar-pause')).toBeVisible();
      const playing = `${selector}, [data-testid="time-bar-pause"]`;
      const withBar = await settledStill(win, playing, `${where}, the video playing`);
      expect(
        withBar.some((p) => p.includes(' time-bar-pause: ')),
        `${where}: the time bar's Pause is there`,
      ).toBe(true);
      expect(await startWatching(win, playing)).toBe(withBar.length);
      expect((await dispatch(win, { type: 'cueVideo', mediaId: other })).ok).toBe(true);
      await expect(win.getByTestId('video-cue')).toBeVisible();
      await letTimePass(win, 300, 'the card up');
      rows.push(await geometry(win, `${where}: cued again, a video playing`));
      await cancelButton(win).click();
      await expect(win.getByTestId('video-cue')).toHaveCount(0);
      await expect.poll(async () => (await snapshot(win)).videoCue ?? null).toBeNull();
      await letTimePass(win, 500, 'frames after Cancel');
      const cancelled = await stopWatching(win);
      expect(cancelled.moved, `${where}: what moved as the card came and went with Cancel`).toEqual([]);
      expect(await stillParts(win, playing), `${where}: after Cancel`).toEqual(withBar);
      expect(await stillParts(win, selector), `${where}: after Cancel, as before the cue`).toEqual(before);
      expect(await backgroundId(win), `${where}: Cancel leaves the screens as they were`).toBe(id);
    }
  } finally {
    await attachGeometry(rows);
    await app.close();
  }
});

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645 and 1410 × 900: a picture up (the zoom buttons come), then a video (they go): LIVE’s picture, Back, Next${mode === 'pro' ? ' and Oops' : ''} never move, at any frame`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp();
    const rows: Geometry[] = [];
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const dir = mkdtempSync(join(tmpdir(), 'drashti-cue-still-'));
      const picture = await makeTestImage(win, join(dir, 'Placeholder still picture.png'), {
        width: 640,
        height: 360,
        color: '#1d4e89',
      });
      const video = await makeTestVideo(win, join(dir, 'Placeholder still clip.webm'), {
        seconds: 4,
        hue: 120,
      });
      const [pictureId = '', videoId = ''] = await importAndGetIds(win, [picture, video]);
      await slidesUp(win);
      if (mode === 'simple') {
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      const selector = stillOf(mode);
      for (const size of SIZES) {
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${sizeName(size)}`;
        expect((await dispatch(win, { type: 'clearLayer', layer: 'background' })).ok).toBe(true);
        await expect(win.getByTestId('live-zoom')).toHaveCount(0);
        await expect(win.getByTestId('time-bars')).toHaveCount(0);
        await sizeOperatorWindow(app, win, size);
        await liveColumnToTop(liveColumn(win));
        const before = await settledStill(win, selector, where);
        expect(before.length, `${where}: every still part is there`).toBe(mode === 'pro' ? 4 : 3);
        rows.push(await geometry(win, `${where}: before the picture`));
        expect(await startWatching(win, selector)).toBe(before.length);
        expect(
          (
            await dispatch(win, {
              type: 'setBackground',
              background: { kind: 'media', mediaId: pictureId, media: 'image', fit: 'fit', loop: false },
            })
          ).ok,
        ).toBe(true);
        await expect(win.getByTestId('live-zoom')).toBeVisible();
        await letTimePass(win, 500, 'the zoom buttons up');
        rows.push(await geometry(win, `${where}: the picture up`));
        expect(
          (
            await dispatch(win, {
              type: 'setBackground',
              background: { kind: 'media', mediaId: videoId, media: 'video', fit: 'fill', loop: true },
            })
          ).ok,
        ).toBe(true);
        await expect(win.getByTestId('live-zoom')).toHaveCount(0);
        await expect(win.locator('[data-testid="time-bar-row"][data-playing="background"]')).toBeVisible();
        await letTimePass(win, 1000, 'a second of frames with the video');
        rows.push(await geometry(win, `${where}: the video up`));
        const watched = await stopWatching(win);
        expect(watched.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
        expect(watched.moved, `${where}: what moved as the zoom buttons came and went`).toEqual([]);
        expect(await stillParts(win, selector), `${where}: the video up`).toEqual(before);
      }
    } finally {
      await attachGeometry(rows);
      await app.close();
    }
  });

/** The focused control's name, as a screen reader says it. */
const focusedName = (win: Page) =>
  win.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'nothing';
    return el.getAttribute('aria-label') ?? el.textContent.trim();
  });

/** Whether the focused control is one of the time bars' (their Play or Pause, bar, captions or More). */
const focusInBars = (win: Page) =>
  win.evaluate(() => document.activeElement?.closest('[data-testid="time-bars"]') !== null);

/**
 * Tab from Oops until Cancel (at most 12 presses): each stop's name, and whether every stop before Go was one of the
 * time bars' (the card comes under them, so while something plays they are the stops between Oops and Go).
 */
async function tabFromOops(win: Page): Promise<{ stops: string[]; onlyBarsBeforeGo: boolean }> {
  await win.getByTestId('show-oops').focus();
  await expect(win.getByTestId('show-oops')).toBeFocused();
  const stops: string[] = [];
  let onlyBarsBeforeGo = true;
  for (let i = 0; i < 12; i++) {
    await win.keyboard.press('Tab');
    const name = await focusedName(win);
    stops.push(name);
    if (name === 'Cancel video cue') break;
    if (!stops.includes('Go cued video') && !(await focusInBars(win))) onlyBarsBeforeGo = false;
  }
  return { stops, onlyBarsBeforeGo };
}

test('Pro Mode: the cued video’s Go and Cancel are the keyboard’s next stops after Oops, and Enter on each does what it says', async () => {
  test.setTimeout(180_000);
  const { app, win, ids } = await setupVideoCue();
  try {
    const first = ids[1] ?? '';
    const second = ids[0] ?? '';
    await slidesUp(win);
    const oops = win.getByTestId('show-oops');
    await expect(oops).toBeEnabled();
    // Go: nothing playing, so Oops, then Tab, Tab.
    expect((await dispatch(win, { type: 'cueVideo', mediaId: first })).ok).toBe(true);
    await cueReady(win);
    await expect(goButton(win)).toBeEnabled();
    await oops.focus();
    await expect(oops).toBeFocused();
    const order: string[] = [];
    for (let i = 0; i < 2; i++) {
      await win.keyboard.press('Tab');
      order.push(await focusedName(win));
    }
    await test.info().attach('cuestill-tab-order.json', {
      body: Buffer.from(JSON.stringify(order)),
      contentType: 'application/json',
    });
    expect(order, 'the stops after Oops').toEqual(['Go cued video', 'Cancel video cue']);
    await win.keyboard.press('Shift+Tab');
    await expect(goButton(win)).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('video-cue')).toHaveCount(0);
    await expect.poll(() => backgroundId(win)).toBe(first);
    // Cancel: cued again while that video plays: from Oops, the time bar's own stops, then Go, then Cancel; Enter on
    // it: the cue gone, the screens as they were. The video put up again going round, so its end never changes the bar.
    const looping = await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: first, media: 'video', fit: 'fill', loop: true },
    });
    expect(looping.ok).toBe(true);
    await expect(win.locator('[data-testid="time-bar-row"][data-playing="background"]')).toBeVisible();
    expect((await dispatch(win, { type: 'cueVideo', mediaId: second })).ok).toBe(true);
    await cueReady(win);
    await expect(oops).toBeEnabled();
    const walk = await tabFromOops(win);
    await test.info().attach('cuestill-tab-order-playing.json', {
      body: Buffer.from(JSON.stringify(walk)),
      contentType: 'application/json',
    });
    expect(walk.stops.slice(-2), 'the last stops of the walk from Oops').toEqual([
      'Go cued video',
      'Cancel video cue',
    ]);
    expect(
      walk.onlyBarsBeforeGo,
      `nothing but the time bars between Oops and Go: ${walk.stops.join(' | ')}`,
    ).toBe(true);
    await expect(cancelButton(win)).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('video-cue')).toHaveCount(0);
    await expect.poll(async () => (await snapshot(win)).videoCue ?? null).toBeNull();
    expect(await backgroundId(win)).toBe(first);
  } finally {
    await app.close();
  }
});

test('Pro Mode at 1024 × 645 with every LIVE section open and a video playing: the cued video’s Go is in sight, whole, without scrolling', async () => {
  test.setTimeout(180_000);
  const { app, win, ids } = await setupVideoCue();
  const rows: Geometry[] = [];
  try {
    await slidesUp(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: ids[0] ?? '', media: 'video', fit: 'fill', loop: true },
        })
      ).ok,
    ).toBe(true);
    await expect(win.locator('[data-testid="time-bar-row"][data-playing="background"]')).toBeVisible();
    await openAllSections(win);
    const live = liveColumn(win);
    await liveColumnToTop(live);
    rows.push(await geometry(win, 'Pro Mode at 1024 × 645, every section open, a video playing'));
    expect((await dispatch(win, { type: 'cueVideo', mediaId: ids[1] ?? '' })).ok).toBe(true);
    await cueReady(win);
    await expect(goButton(win)).toBeEnabled();
    rows.push(await geometry(win, 'the same, a video cued'));
    await expect(goButton(win)).toBeInViewport({ ratio: 1 });
    const seen = await live.evaluate((column) => {
      const scroll = column.querySelector('[data-testid="live-scroll"]');
      const go = column.querySelector('button[aria-label="Go cued video"]');
      if (!scroll || !go) return 'no live-scroll or no Go';
      const s = scroll.getBoundingClientRect();
      const g = go.getBoundingClientRect();
      const out: string[] = [];
      if (g.top < s.top - 0.5 || g.bottom > s.bottom + 0.5)
        out.push(
          `Go ${g.top.toFixed(1)}-${g.bottom.toFixed(1)} outside live-scroll ${s.top.toFixed(1)}-${s.bottom.toFixed(1)}`,
        );
      if (scroll.scrollTop !== 0) out.push(`live-scroll scrolled ${String(scroll.scrollTop)}`);
      if (column.scrollTop !== 0) out.push(`the column scrolled ${String(column.scrollTop)}`);
      return out.join('; ');
    });
    expect(seen, 'Go in sight without scrolling').toBe('');
  } finally {
    await attachGeometry(rows);
    await app.close();
  }
});

/*
 * LIVE's own rows and lines (alpha.24, lead 2's liverows; a25 list items 27, 42, 43, 46). Until then a timer for the
 * audience, a timer alone and Repeat Slides came in ABOVE LIVE's picture, and the picture-in-picture strip and LIVE's
 * lines (a file missing, "Starting on …", the languages, …) UNDER it, between the picture and Next and Back: each pushed
 * the picture, Back, Next and Oops (or Back, Next and Oops) down as it came and lifted them as it went, and the card's
 * Go with them. Now they sit under the show controls (the time bars, the card, the zoom buttons); the time bars keep
 * their room while the card or the zoom buttons are up under them, so a bar going never lifts Go, Cancel or + and −;
 * the card goes to one row in a narrow column; and the practice show draws no card (its Go acted on the hall).
 */

/** A timer for the audience, made as a show makes one (placeholder-show.ts's), and its id. */
async function makeTimer(win: Page): Promise<string> {
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.timers.create({
      name: 'Placeholder starts in',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
  });
  let id = '';
  await expect
    .poll(async () => {
      id = (await snapshot(win)).timers.find((t) => t.name === 'Placeholder starts in')?.id ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

/** LIVE's rows up: the timer for the audience (above the picture until alpha.24) and the picture-in-picture strip. */
async function rowsUp(win: Page, timerId: string): Promise<void> {
  expect((await dispatch(win, { type: 'showAudienceTimer', timerId })).ok).toBe(true);
  await expect(win.getByTestId('live-audience-timer')).toBeVisible();
  expect((await dispatch(win, { type: 'showPip', source: { kind: 'slides' } })).ok).toBe(true);
  await expect(win.getByTestId('live-pip')).toBeVisible();
}

async function rowsDown(win: Page): Promise<void> {
  expect((await dispatch(win, { type: 'hidePip' })).ok).toBe(true);
  await expect(win.getByTestId('live-pip')).toHaveCount(0);
  expect((await dispatch(win, { type: 'hideAudienceTimer' })).ok).toBe(true);
  await expect(win.getByTestId('live-audience-timer')).toHaveCount(0);
}

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at 1024 × 645 and 1410 × 900: LIVE’s own rows come and go (a timer for the audience, the picture-in-picture strip): LIVE’s picture, Back, Next${mode === 'pro' ? ' and Oops' : ''} never move, at any frame`, async () => {
    test.setTimeout(150_000);
    const { app } = await launchApp();
    const rows: Geometry[] = [];
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const timerId = await makeTimer(win);
      await slidesUp(win);
      if (mode === 'simple') {
        // PiP must be chosen in Pro Mode before Simple Mode may show or hide it (as in simple-features.spec.ts).
        const enabled = await win.evaluate(() =>
          (globalThis as PageGlobals).drashti.app.setSimpleFeature('picture-in-picture', true),
        );
        expect(enabled.ok).toBe(true);
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }
      const selector = stillOf(mode);
      for (const size of SIZES) {
        const where = `${mode === 'pro' ? 'Pro' : 'Simple'} Mode at ${sizeName(size)}`;
        await sizeOperatorWindow(app, win, size);
        await liveColumnToTop(liveColumn(win));
        const before = await settledStill(win, selector, where);
        expect(before.length, `${where}: every still part is there`).toBe(mode === 'pro' ? 4 : 3);
        rows.push(await geometry(win, `${where}: before LIVE's rows`));
        expect(await startWatching(win, selector)).toBe(before.length);
        await rowsUp(win, timerId);
        await sampleFrames(win, 'LIVE’s rows up');
        rows.push(await geometry(win, `${where}: LIVE's rows up`));
        await rowsDown(win);
        await sampleFrames(win, 'frames after LIVE’s rows went');
        const watched = await stopWatching(win);
        expect(watched.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
        expect(watched.moved, `${where}: what moved as LIVE’s rows came and went`).toEqual([]);
        expect(await stillParts(win, selector), `${where}: LIVE's rows gone`).toEqual(before);
      }
    } finally {
      await attachGeometry(rows);
      await app.close();
    }
  });

test('Pro Mode at 1024 × 645 and 1410 × 900: a cued video waiting while a video plays, the playing video taken off (its time bar goes): the card’s Go and Cancel never move, at any frame', async () => {
  test.setTimeout(180_000);
  const { app, win, ids } = await setupVideoCue();
  const rows: Geometry[] = [];
  try {
    await slidesUp(win);
    await expect(win.getByTestId('show-oops')).toBeEnabled();
    const selector = `${stillOf('pro')}, button[aria-label="Go cued video"], button[aria-label="Cancel video cue"]`;
    for (const [i, size] of SIZES.entries()) {
      const where = `Pro Mode at ${sizeName(size)}`;
      const playing = ids[i % 2] ?? '';
      const cued = ids[(i + 1) % 2] ?? '';
      await sizeOperatorWindow(app, win, size);
      await liveColumnToTop(liveColumn(win));
      // A video going round, then a cue while it plays.
      expect(
        (
          await dispatch(win, {
            type: 'setBackground',
            background: { kind: 'media', mediaId: playing, media: 'video', fit: 'fill', loop: true },
          })
        ).ok,
      ).toBe(true);
      await expect(win.locator('[data-testid="time-bar-row"][data-playing="background"]')).toBeVisible();
      expect((await dispatch(win, { type: 'cueVideo', mediaId: cued })).ok).toBe(true);
      await cueReady(win);
      await expect(goButton(win)).toBeEnabled();
      const before = await settledStill(win, selector, `${where}, a cue waiting`);
      expect(before.length, `${where}: the picture, Back, Next, Oops, Go and Cancel are there`).toBe(6);
      rows.push(await geometry(win, `${where}: a cue waiting, a video playing`));
      const waiting = (await snapshot(win)).videoCue?.id;
      expect(waiting, 'the manual cue is waiting').toBeTruthy();
      expect(await startWatching(win, selector)).toBe(before.length);
      // Replacing the playing background with a colour removes its bar and keeps the manual cue. clearLayer
      // deliberately cancels every video cue (show-engine.ts), so it cannot exercise a waiting cue's position.
      expect(
        (await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } })).ok,
      ).toBe(true);
      expect((await snapshot(win)).videoCue?.id, 'the same manual cue is still waiting').toBe(waiting);
      await expect(win.getByTestId('time-bars')).toHaveCount(0);
      await sampleFrames(win, 'frames after the time bar went');
      rows.push(await geometry(win, `${where}: the video taken off`));
      const watched = await stopWatching(win);
      expect(watched.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
      expect(watched.moved, `${where}: what moved as the time bar went`).toEqual([]);
      expect(await stillParts(win, selector), `${where}: the video taken off`).toEqual(before);
      await cancelButton(win).click();
      await expect(win.getByTestId('video-cue')).toHaveCount(0);
      await expect.poll(async () => (await snapshot(win)).videoCue ?? null).toBeNull();
    }
  } finally {
    await attachGeometry(rows);
    await app.close();
  }
});

test('Pro Mode at 1024 × 645 with every LIVE section open, a video playing, LIVE’s rows up and a notice: the cued video’s card is one row and its Go is in sight, whole, without scrolling', async () => {
  test.setTimeout(180_000);
  const { app, win, ids } = await setupVideoCue();
  const rows: Geometry[] = [];
  try {
    const timerId = await makeTimer(win);
    await slidesUp(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: ids[0] ?? '', media: 'video', fit: 'fill', loop: true },
        })
      ).ok,
    ).toBe(true);
    await expect(win.locator('[data-testid="time-bar-row"][data-playing="background"]')).toBeVisible();
    await openAllSections(win);
    await rowsUp(win, timerId);
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows())
        if (w.webContents.getURL().includes('index.html'))
          w.webContents.send('app:notice', { text: 'Placeholder notice' });
    });
    await expect(win.getByTestId('operator-notice')).toBeVisible();
    const live = liveColumn(win);
    await liveColumnToTop(live);
    expect((await dispatch(win, { type: 'cueVideo', mediaId: ids[1] ?? '' })).ok).toBe(true);
    await cueReady(win);
    await expect(goButton(win)).toBeEnabled();
    rows.push(
      await geometry(
        win,
        'Pro Mode at 1024 × 645: every section open, a video, LIVE’s rows, a notice, a cue',
      ),
    );
    // One row at CI's width: no taller than its Go and Cancel with the card's own room around them.
    const card = await win.getByTestId('video-cue').boundingBox();
    const go = await goButton(win).boundingBox();
    if (!card || !go) throw new Error('no card or no Go');
    expect(
      card.height,
      `the card (${String(card.height)} px) is one row, about its Go (${String(go.height)} px)`,
    ).toBeLessThanOrEqual(go.height + 18.5);
    await expect(goButton(win)).toBeInViewport({ ratio: 1 });
    const seen = await live.evaluate((column) => {
      const scroll = column.querySelector('[data-testid="live-scroll"]');
      const go = column.querySelector('button[aria-label="Go cued video"]');
      if (!scroll || !go) return 'no live-scroll or no Go';
      const s = scroll.getBoundingClientRect();
      const g = go.getBoundingClientRect();
      const out: string[] = [];
      if (g.top < s.top - 0.5 || g.bottom > s.bottom + 0.5)
        out.push(
          `Go ${g.top.toFixed(1)}-${g.bottom.toFixed(1)} outside live-scroll ${s.top.toFixed(1)}-${s.bottom.toFixed(1)}`,
        );
      if (scroll.scrollTop !== 0) out.push(`live-scroll scrolled ${String(scroll.scrollTop)}`);
      if (column.scrollTop !== 0) out.push(`the column scrolled ${String(column.scrollTop)}`);
      const hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
      if (!hit || !go.contains(hit))
        out.push(
          `Go's middle is under ${hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? 'nothing'}`,
        );
      return out.join('; ');
    });
    expect(seen, 'Go in sight without scrolling').toBe('');
  } finally {
    await attachGeometry(rows);
    await app.close();
  }
});

test('Pro Mode, practising: the show’s cued video’s card is not drawn (its Go would act on the hall’s screens); the cue waits, and its card is back when practice ends', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-cue-practice-'));
    const video = await makeTestVideo(win, join(dir, 'Placeholder practice clip.webm'), {
      seconds: 4,
      hue: 60,
    });
    const [videoId = ''] = await importAndGetIds(win, [video]);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const [p] = await d.library.listPresentations();
      if (!p) throw new Error('no placeholder presentation');
      const list = await d.playlists.create('Placeholder practice', null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: p.id },
      ]);
      if (!added.ok) throw new Error(added.message);
    });
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder practice' }).click();
    await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(1);
    expect((await dispatch(win, { type: 'cueVideo', mediaId: videoId })).ok).toBe(true);
    await expect(win.getByTestId('video-cue')).toBeVisible();
    await win.getByTestId('open-playlist').getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Practise this playlist' }).click();
    await expect(win.getByTestId('practice-banner')).toContainText('Practising “Placeholder practice”');
    const first = win.getByTestId('practice-thumb').first();
    const slide = await first.locator('[data-slide]').getAttribute('data-slide');
    if (!slide) throw new Error('no first practice slide');
    await first.click();
    await expect(first).toHaveAttribute('aria-current', 'true');
    await expect(win.getByTestId('live-preview').locator('[data-slide]').first()).toHaveAttribute(
      'data-slide',
      slide,
    );
    await expect(win.getByTestId('video-cue'), 'no show cue in practice').toHaveCount(0);
    await expect(goButton(win)).toHaveCount(0);
    expect((await snapshot(win)).videoCue?.background.mediaId, 'the show’s cue waits').toBe(videoId);
    await win.getByTestId('practice-leave').click();
    await expect(win.getByTestId('practice-banner')).toHaveCount(0);
    await expect(win.getByTestId('video-cue'), 'the cue’s card back after practice').toBeVisible();
    await expect(cancelButton(win)).toBeVisible();
  } finally {
    await app.close();
  }
});

/** State words and each button's contents must stay inside their own room and clear of one another. */
const cueFit = (win: Page) =>
  win.getByTestId('video-cue').evaluate((card) => {
    const faults: string[] = [];
    const status = card.querySelector('[role="status"]');
    const state = status?.lastElementChild;
    const buttons = [...card.querySelectorAll('button')];
    if (!status || !state || buttons.length !== 2) throw new Error('no cue state or controls');
    const inside = (r: DOMRect, box: DOMRect) =>
      r.left >= box.left - 0.5 &&
      r.right <= box.right + 0.5 &&
      r.top >= box.top - 0.5 &&
      r.bottom <= box.bottom + 0.5;
    const cardBox = card.getBoundingClientRect();
    const words = document.createRange();
    words.selectNodeContents(state);
    for (const r of words.getClientRects()) {
      if (!inside(r, status.getBoundingClientRect()))
        faults.push('state words overflow their information box');
      if (!inside(r, cardBox)) faults.push('state words overflow the card');
      for (const button of buttons) {
        const b = button.getBoundingClientRect();
        if (
          Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0.5 &&
          Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0.5
        )
          faults.push(`state words overlap ${button.textContent}`);
      }
    }
    for (const button of buttons) {
      const b = button.getBoundingClientRect();
      if (!inside(b, cardBox)) faults.push(`${button.textContent} overflows the card`);
      const content = document.createRange();
      content.selectNodeContents(button);
      const style = getComputedStyle(button);
      for (const r of content.getClientRects()) {
        if (
          !inside(r, b) ||
          r.left < b.left + parseFloat(style.paddingLeft) - 0.5 ||
          r.right > b.right - parseFloat(style.paddingRight) + 0.5
        )
          faults.push(`${button.textContent} is not whole inside its button`);
      }
    }
    return faults;
  });

interface CueHold {
  cueStillPending?: { reports: number; release: () => Promise<void> };
}

test('Pro Mode, LIVE at its 300 px minimum: pending, ready and error words and buttons fit whole, and Go and Cancel never move', async () => {
  test.setTimeout(180_000);
  const { app, win, hall, ids } = await setupVideoCue();
  const rows: Geometry[] = [];
  try {
    await slidesUp(win);
    for (const size of [CI_WINDOW, { width: 1280, height: 720 }, OWNERS_WINDOW]) {
      const where = `300 px LIVE at ${sizeName(size)}`;
      await sizeOperatorWindow(app, win, size);
      const splitter = win.getByRole('separator', { name: 'Resize the live column', exact: true });
      await splitter.focus();
      await splitter.press('Home');
      await expect(splitter).toHaveAttribute('aria-valuenow', '300');
      await expect.poll(async () => (await win.getByTestId('column-right').boundingBox())?.width).toBe(300);
      await liveColumnToTop(liveColumn(win));
      await win.evaluate(() => document.fonts.ready.then(() => undefined));
      // Hold the real hall page's acknowledgement, never a wall-clock delay or a fabricated ready state.
      await hall.evaluate(() => {
        const g = globalThis as PageGlobals & CueHold;
        const bridge = g.drashti;
        const queued: Parameters<typeof bridge.engine.videoCueReady>[] = [];
        let held = true;
        const pending = {
          reports: 0,
          release: async () => {
            held = false;
            for (const args of queued) await bridge.engine.videoCueReady(...args);
          },
        };
        g.cueStillPending = pending;
        g.drashti = {
          ...bridge,
          engine: {
            ...bridge.engine,
            videoCueReady: async (...args) => {
              if (held && args[1] === 'picture') {
                queued.push(args);
                pending.reports += 1;
                return null;
              }
              return bridge.engine.videoCueReady(...args);
            },
          },
        };
      });
      expect((await dispatch(win, { type: 'cueVideo', mediaId: ids[1] ?? '' })).ok).toBe(true);
      await expect
        .poll(() => hall.evaluate(() => (globalThis as CueHold).cueStillPending?.reports ?? 0))
        .toBeGreaterThan(0);
      const cue = (await snapshot(win)).videoCue;
      if (!cue) throw new Error('no pending cue');
      expect(
        cue.required.some((id) => !cue.ready.includes(id)),
        'a required page is still pending',
      ).toBe(true);
      const status = win.getByTestId('video-cue').getByRole('status');
      await expect(status).toContainText('Preparing first frame…');
      await expect(goButton(win)).toBeDisabled();
      const selector = 'button[aria-label="Go cued video"], button[aria-label="Cancel video cue"]';
      const before = await settledStill(win, selector, `${where}: pending`);
      expect(before).toHaveLength(2);
      const faults = [{ state: 'pending', faults: await cueFit(win) }];
      rows.push(await geometry(win, `${where}: pending`));
      expect(await startWatching(win, selector)).toBe(2);
      await hall.evaluate(async () => {
        const pending = (globalThis as CueHold).cueStillPending;
        if (!pending) throw new Error('no held hall page');
        await pending.release();
      });
      await cueReady(win);
      await expect(status).toContainText('Cue ready');
      await expect(goButton(win)).toBeEnabled();
      await sampleFrames(win, `${where}: ready`);
      faults.push({ state: 'ready', faults: await cueFit(win) });
      rows.push(await geometry(win, `${where}: ready`));
      await hall.evaluate(
        (id) => (globalThis as PageGlobals).drashti.engine.videoCueReady(id, 'picture', false),
        cue.id,
      );
      await expect(status).toContainText(
        'The cued video could not load its first frame: Cancel and cue it again.',
      );
      await expect(goButton(win)).toBeDisabled();
      await sampleFrames(win, `${where}: error`);
      faults.push({ state: 'error', faults: await cueFit(win) });
      rows.push(await geometry(win, `${where}: error`));
      const watched = await stopWatching(win);
      await test.info().attach(`cue-fit-${String(size.width)}.json`, {
        body: Buffer.from(JSON.stringify({ faults, before, watched }, null, 1)),
        contentType: 'application/json',
      });
      expect(
        faults.flatMap(({ state, faults }) => faults.map((f) => `${state}: ${f}`)),
        where,
      ).toEqual([]);
      expect(watched.looks, `${where}: looked at every frame`).toBeGreaterThan(10);
      expect(watched.moved, `${where}: Go and Cancel through all three states`).toEqual([]);
      expect(await stillParts(win, selector), `${where}: error controls stay put`).toEqual(before);
      await cancelButton(win).click();
      await expect(win.getByTestId('video-cue')).toHaveCount(0);
    }
  } finally {
    await attachGeometry(rows);
    await app.close();
  }
});
