import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TransitionKind } from '../../src/shared/model';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';
import { EASE } from '../../src/renderer/src/render/easing';
import { canvasPixels } from './pixels';

/*
 * Each transition the same on two screens (Session 26d): two audience
 * outputs, held at the same moments of the engine's clock (a test switch),
 * part-way through a fade, a fade through black, a slide and a slow zoom.
 * Every point compared between the two, and with the colours the transition
 * should give there. Generated pictures only: two colours side by side.
 */

const MS = 3000;
const OLD = { left: [200, 40, 40], right: [40, 200, 40] } as const;
const NEW = { left: [40, 40, 200], right: [200, 200, 40] } as const;

/** A picture of two colours side by side, drawn in the page. */
async function splitPicture(page: Page, file: string, left: readonly number[], right: readonly number[]) {
  const base64 = await page.evaluate(
    ({ left, right }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = `rgb(${left.join(',')})`;
      ctx.fillRect(0, 0, 320, 360);
      ctx.fillStyle = `rgb(${right.join(',')})`;
      ctx.fillRect(320, 0, 320, 360);
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { left: [...left], right: [...right] },
  );
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

const hold = (app: ElectronApplication, at: number | null) =>
  app.evaluate(
    (_e, at) =>
      (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock?.(at) ??
      0,
    at,
  );

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Points on the canvas: a quarter in, the middle and three quarters in, along the middle line. */
const POINTS = [
  { x: 480, y: 540 },
  { x: 960, y: 300 },
  { x: 1440, y: 540 },
  { x: 480, y: 900 },
  { x: 1440, y: 900 },
];

/*
 * The screens' compositing is not exactly the mix in sRGB numbers: a dark channel rising (40 to 200) reads
 * about 15 above it part-way (measured: 95 for 80, 134 for 120), a falling one within 1. So the colours a
 * transition should give are checked within 18; the two screens against each other within 6.
 */
const close = (a: readonly number[] | undefined, b: readonly number[], within = 18) =>
  a !== undefined && b.every((c, i) => Math.abs((a[i] ?? -999) - c) <= within);
const mix = (a: readonly number[], b: readonly number[], p: number) =>
  a.map((c, i) => c * (1 - p) + (b[i] ?? 0) * p);
const dim = (a: readonly number[], f: number) => a.map((c) => c * f);

/** What each transition should show at the left quarter and the right quarter, at `p`. */
function expected(kind: TransitionKind, p: number): { left: number[]; right: number[] } | null {
  switch (kind) {
    // Session 27's kinds move only words: these slides are pictures alone, so on Calm screens they fade.
    case 'wipe':
    case 'push':
    case 'zoom-dissolve':
    case 'lines':
    case 'words':
    case 'dissolve':
    case 'zoom': {
      // Calm's eased dissolve (Session 27): smoothstep, in + out = 1.
      const e = EASE.smooth(p);
      return { left: mix(OLD.left, NEW.left, e), right: mix(OLD.right, NEW.right, e) };
    }
    case 'fade-black': {
      const black = 1 - Math.abs(2 * p - 1);
      return p < 0.5
        ? { left: dim(OLD.left, 1 - black), right: dim(OLD.right, 1 - black) }
        : { left: dim(NEW.left, 1 - black), right: dim(NEW.right, 1 - black) };
    }
    case 'slide':
      // Half-way the old slide's right half is on the left, and the new one's left half on the right.
      return p === 0.5 ? { left: [...OLD.right], right: [...NEW.left] } : null;
    case 'cut':
      return null;
  }
}

test('each transition is the same on two screens at the same moment, and gives the colours it should', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
    DRASHTI_TEST_CLOCK_HOLD: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-transition-pixels-'));
  const oldPicture = await splitPicture(win, join(dir, 'Placeholder old.png'), OLD.left, OLD.right);
  const newPicture = await splitPicture(win, join(dir, 'Placeholder new.png'), NEW.left, NEW.right);
  const [oldId = '', newId = ''] = await importAndGetIds(win, [oldPicture, newPicture]);
  // A Repeat Slides playlist of the two that never moves on by itself here (600 s each).
  const playlistId = await win.evaluate(
    async ({ oldId, newId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.createRepeat(null);
      const id = made.ok ? (made.ids[0] ?? '') : '';
      await d.playlists.addItems(id, null, [
        { kind: 'media', mediaId: oldId },
        { kind: 'media', mediaId: newId },
      ]);
      return id;
    },
    { oldId, newId },
  );
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Side Hall', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [one, two] = outputPages(app);
  if (!one || !two) throw new Error('two screens expected');
  const both = [one, two];
  // Once round (cut), so both pictures are loaded and drawn before anything is measured.
  const settings = (kind: TransitionKind, durationMs: number) =>
    win.evaluate(
      ({ id, kind, durationMs }) =>
        (globalThis as PageGlobals).drashti.playlists.setRepeat(id, {
          secondsEach: 600,
          transition: { kind, durationMs },
        }),
      { id: playlistId, kind, durationMs },
    );
  const show = (slideIndex: number) =>
    win.evaluate(
      ({ id, slideIndex }) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'startRepeat',
          playlistId: id,
          slideIndex,
        }),
      { id: playlistId, slideIndex },
    );
  await settings('cut', 0);
  for (const i of [1, 0]) {
    await show(i);
    for (const p of both) await expect(p.locator('[data-layer="slide"] img')).toHaveCount(1);
  }
  for (const p of both)
    await expect
      .poll(async () => close((await canvasPixels(p, [POINTS[0] ?? { x: 0, y: 0 }]))[0], OLD.left))
      .toBe(true);

  for (const kind of [
    'dissolve',
    'fade-black',
    'slide',
    'zoom',
    'wipe',
    'push',
    'zoom-dissolve',
    'lines',
    'words',
  ] as const) {
    await settings(kind, MS);
    await hold(app, null);
    await show(0);
    for (const p of both) await expect(p.locator('[data-fading="true"]')).toHaveCount(0, { timeout: MS * 3 });
    // Held before the next slide comes on: it waits at its very start on both screens.
    await hold(app, Date.now() - 60_000);
    await show(1);
    const shownAt = (await snapshot(win)).layers.slide?.shownAt ?? 0;
    for (const p of both)
      await expect(p.locator('[data-layer="slide"][data-fading="true"]')).toHaveAttribute(
        'data-fade-start',
        String(shownAt),
      );
    for (const at of [0.25, 0.5, 0.75]) {
      await hold(app, shownAt + at * MS);
      for (const p of both)
        await expect(p.locator('[data-layer="slide"]')).toHaveAttribute('data-fade', at.toFixed(3));
      const [a, b] = [await canvasPixels(one, POINTS), await canvasPixels(two, POINTS)];
      // The two screens the same, point for point.
      for (const [i, colour] of a.entries())
        expect(
          close(colour, b[i] ?? [], 6),
          `${kind} at ${String(at)}, point ${String(i)}: ${String(colour)} and ${String(b[i])}`,
        ).toBe(true);
      // And what the transition should give there.
      const want = expected(kind, at);
      if (want) {
        expect(
          close(a[0], want.left),
          `${kind} at ${String(at)}, left: ${String(a[0])}, wanted ${String(want.left)}`,
        ).toBe(true);
        expect(
          close(a[2], want.right),
          `${kind} at ${String(at)}, right: ${String(a[2])}, wanted ${String(want.right)}`,
        ).toBe(true);
      }
    }
    // A slow zoom grows the slide on both screens alike, by the engine's clock.
    if (kind === 'zoom') {
      await hold(app, shownAt + 300_000);
      const scales = await Promise.all(
        both.map((p) =>
          p.locator('[data-slide-in] [data-zoom]').evaluate((el) => getComputedStyle(el).transform),
        ),
      );
      expect(scales[0]).toBe(scales[1]);
      expect(scales[0]).toMatch(/^matrix\(1\.0[3-5]/u);
    }
    await hold(app, null);
  }

  // Bold for the side hall's group only (Session 27): a dissolve there eases on Bold's curve, while the
  // main hall's stays Calm's, at the same held moment of the same engine change.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const side = (await d.screens.get()).groups.find((g) => g.name === 'Side Hall')?.id ?? '';
    const set = await d.looks.setGroup((await d.engine.snapshot()).state.look.id, side, { movement: 'bold' });
    if (!set.ok) throw new Error(set.message);
  });
  await expect(two.getByTestId('output-root')).toHaveAttribute('data-movement', 'bold');
  await expect(one.getByTestId('output-root')).toHaveAttribute('data-movement', 'calm');
  await settings('dissolve', MS);
  await show(0);
  for (const p of both) await expect(p.locator('[data-fading="true"]')).toHaveCount(0, { timeout: MS * 3 });
  await hold(app, Date.now() - 60_000);
  await show(1);
  const shownAt = (await snapshot(win)).layers.slide?.shownAt ?? 0;
  await hold(app, shownAt + 0.25 * MS);
  for (const p of both) await expect(p.locator('[data-layer="slide"]')).toHaveAttribute('data-fade', '0.250');
  const opacity = (p: Page) =>
    p.locator('[data-slide-in]').evaluate((el) => Number((el as HTMLElement).style.opacity));
  expect(await opacity(one)).toBeCloseTo(EASE.smooth(0.25), 4);
  expect(await opacity(two)).toBeCloseTo(EASE.inOut(0.25), 4);
  const [calm, bold] = [await canvasPixels(one, POINTS), await canvasPixels(two, POINTS)];
  expect(close(calm[0], mix(OLD.left, NEW.left, EASE.smooth(0.25))), `Calm: ${String(calm[0])}`).toBe(true);
  expect(close(bold[0], mix(OLD.left, NEW.left, EASE.inOut(0.25))), `Bold: ${String(bold[0])}`).toBe(true);
  await hold(app, null);
  await app.close();
});
