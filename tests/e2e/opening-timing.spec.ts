import { expect, test } from '@playwright/test';
import { OPENING_DEFAULT_PHOTO_URL } from '../../src/shared/opening';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

type TimingGlobals = typeof globalThis & {
  openingDecode?: { previewVisible: boolean | null; readyAt: number | null };
  /** Each frame the operator window drew as Drashti started (the order test below). */
  openingOrder?: OrderFrame[];
  openingCap?: { held: boolean; releasedAt: number | null; lampAt: number | null; decodeStalled: boolean };
};

/** A frame of the operator window as Drashti starts: the window underneath opened, and the opening there and moving. */
interface OrderFrame {
  opened: boolean;
  cover: boolean;
  held: string | null;
  moving: boolean;
}

test('the Opening preview waits for its photo and starts all tracks on one two-second timeline', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await win.emulateMedia({ reducedMotion: 'no-preference' });
    await operatorReady(win);
    await chooseMenuItem(app, 'opening');
    const dialog = win.getByTestId('opening-dialog');
    // The test runner supplies a generated placeholder for the default photo.
    await expect(dialog.locator(`img[src="${OPENING_DEFAULT_PHOTO_URL}"]`)).toBeVisible();

    await win.evaluate((url) => {
      const probe: NonNullable<TimingGlobals['openingDecode']> = { previewVisible: null, readyAt: null };
      (globalThis as TimingGlobals).openingDecode = probe;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
      if (!descriptor || typeof descriptor.value !== 'function') throw new Error('No image decoder.');
      const decode = descriptor.value as (this: HTMLImageElement) => Promise<void>;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (this.src !== url) return decode.call(this);
        HTMLImageElement.prototype.decode = decode;
        return new Promise<void>((release) => {
          const preview = document.querySelector('[data-testid="opening-preview"]');
          probe.previewVisible =
            preview?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ?? false;
          // Release from this renderer immediately after observing the preview.
          queueMicrotask(release);
        })
          .then(() => decode.call(this))
          .then(() => {
            const time = document.timeline.currentTime;
            if (typeof time !== 'number') throw new Error('The document timeline is unavailable.');
            probe.readyAt = time;
          });
      };
    }, OPENING_DEFAULT_PHOTO_URL);
    await dialog.getByTestId('opening-play').click();

    const sample = await win.waitForFunction(() => {
      const decode = (globalThis as TimingGlobals).openingDecode;
      const preview = document.querySelector('[data-testid="opening-preview"]');
      const tracks = preview?.getAnimations({ subtree: true }) ?? [];
      if (typeof decode?.readyAt !== 'number' || tracks.length === 0) return null;
      const starts = tracks.map((a) => a.startTime);
      if (starts.some((start) => typeof start !== 'number')) return null;
      return {
        previewVisible: decode.previewVisible,
        readyAt: decode.readyAt,
        starts: starts.map(Number),
        ends: tracks.map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0)),
      };
    });
    const timing = await sample.jsonValue();
    if (!timing) throw new Error('The opening tracks did not start.');
    expect(timing.previewVisible, 'preview visible when its photo was asked to decode').toBe(false);
    const start = timing.starts[0] ?? -1;
    expect(timing.starts).toEqual([start, start, start]);
    expect(start).toBeGreaterThanOrEqual(timing.readyAt);
    expect(Math.max(...timing.ends)).toBe(2000);
  } finally {
    await app.close();
  }
});

test('as Drashti starts, the opening holds its black until the window underneath has opened, then moves its two seconds over a started window', async () => {
  // On CI's Mac the window starting underneath took the main thread for a second at a time while the opening moved
  // (2,633 ms for its 2,000, Session 57's measurement): it starts under the black instead, and the opening moves once
  // it has opened (its controls drawn with their first data, the page then idle: ui/motion.ts's data-opened).
  test.setTimeout(120_000);
  // A library started once and quit on purpose, so the next start is a person's start of the same version.
  const first = await launchApp();
  await operatorReady(await operatorPage(first.app));
  await first.app.close();
  const { app } = await relaunchApp(first.userData, { DRASHTI_TEST_OPENING: '1' });
  try {
    const win = await operatorPage(app);
    // Every frame from here on: whether the window underneath had opened, and whether the opening was there and moving.
    await win.evaluate(() => {
      const seen: OrderFrame[] = [];
      (globalThis as TimingGlobals).openingOrder = seen;
      const look = () => {
        const player = document.querySelector('[data-testid="opening"]');
        seen.push({
          opened: document.documentElement.hasAttribute('data-opened'),
          cover: player !== null,
          held: player?.getAttribute('data-opening-held') ?? null,
          moving: player !== null && player.getAnimations({ subtree: true }).length > 0,
        });
        if (seen.length < 6000) requestAnimationFrame(look);
      };
      look();
    });
    const cover = win.getByTestId('opening-start');
    await expect(cover).toBeVisible({ timeout: 15_000 });
    // It ends by itself.
    await expect(cover).toHaveCount(0, { timeout: 20_000 });
    const seen = await win.evaluate(() => (globalThis as TimingGlobals).openingOrder ?? []);
    const moved = seen.findIndex((f) => f.moving);
    expect(moved, 'the opening moved').toBeGreaterThanOrEqual(0);
    expect(seen[moved]?.opened, 'the window underneath had opened when the opening first moved').toBe(true);
    // Until then it held, black, over the window.
    const came = seen.findIndex((f) => f.cover);
    expect(came, 'the opening came before it moved').toBeLessThanOrEqual(moved);
    expect(
      seen.slice(came, moved).every((f) => f.cover && !f.moving),
      'black and still from when it came until it moved',
    ).toBe(true);
    // And the window underneath is the operator's, with its controls.
    await operatorReady(win);
  } finally {
    await app.close();
  }
});

test('startup releases the cover at its cap and lights the lamp if the photo still cannot decode', async () => {
  const first = await launchApp();
  try {
    await operatorReady(await operatorPage(first.app));
  } finally {
    await first.app.close();
  }
  const { app } = await relaunchApp(first.userData, { DRASHTI_TEST_OPENING: '1' });
  try {
    const win = await operatorPage(app);
    await win.evaluate((photo) => {
      const probe: NonNullable<TimingGlobals['openingCap']> = {
        held: false,
        releasedAt: null,
        lampAt: null,
        decodeStalled: false,
      };
      (globalThis as TimingGlobals).openingCap = probe;
      const root = document.documentElement;
      const keepClosed = () => root.removeAttribute('data-opened');
      new MutationObserver(keepClosed).observe(root, {
        attributes: true,
        attributeFilter: ['data-opened'],
      });
      keepClosed();

      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
      if (typeof descriptor?.value !== 'function') throw new Error('The image decoder is unavailable.');
      const decode = descriptor.value as HTMLImageElement['decode'];
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        if (this.src !== photo) return decode.call(this);
        probe.decodeStalled = true;
        return new Promise<void>(() => undefined);
      };

      const sample = () => {
        const player = root.querySelector('[data-testid="opening"]');
        const held = player?.getAttribute('data-opening-held');
        if (held === 'true') probe.held = true;
        if (held === 'false') probe.releasedAt ??= performance.now();
        if (player?.querySelector('[data-opening-lamp]')) {
          probe.lampAt ??= performance.now();
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(sample);
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-opening-held'],
      });
      sample();
    }, OPENING_DEFAULT_PHOTO_URL);

    const cover = win.getByTestId('opening-start');
    const player = cover.getByTestId('opening');
    await expect(player).toHaveAttribute('data-opening-held', 'false');
    await expect(player.locator('[data-opening-lamp]')).toHaveCount(1);
    const trace = await win.evaluate(() => ({
      probe: (globalThis as TimingGlobals).openingCap,
      opened: document.documentElement.hasAttribute('data-opened'),
    }));
    expect(trace.opened).toBe(false);
    expect(trace.probe).toMatchObject({ held: true, decodeStalled: true });
    const released = trace.probe?.releasedAt;
    const lamp = trace.probe?.lampAt;
    if (typeof released !== 'number' || typeof lamp !== 'number')
      throw new Error('Opening frames were missed.');
    expect(lamp - released, 'the decode timeout starts when the cover releases').toBeGreaterThanOrEqual(500);
    await expect(cover).toHaveCount(0);
  } finally {
    await app.close();
  }
});
