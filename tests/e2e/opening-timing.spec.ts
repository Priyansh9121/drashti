import { expect, test } from '@playwright/test';
import { OPENING_DEFAULT_PHOTO_URL } from '../../src/shared/opening';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

type TimingGlobals = typeof globalThis & {
  openingDecode?: { previewVisible: boolean | null; readyAt: number | null };
};

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
