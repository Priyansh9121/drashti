import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, NETWORK_ENV, networkOn, pairByQr, pairingCode } from './devices';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPages, setUpScreen } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * Playback markers (Session 14): a video's start and end points and a named
 * marker, set from its Markers button in the media list; as a background it
 * loops between its points, and a jump to the marker from under the live
 * picture lands in step on two output windows and the audio player (which
 * plays its sound). A generated video with a tone only.
 */

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

const FRAME = 1 / 30;

interface Timing {
  startedAt: number;
  clip: { startMs: number; endMs: number | null };
  seek?: { at: number; toMs: number };
}

/** How far a window's copy is from where the clock says (seconds), the median of a few samples. */
function offsetOf(page: Page, selector: string, t: Timing): Promise<number | null> {
  return page.evaluate(
    async ({ selector, t }) => {
      const samples: number[] = [];
      for (let i = 0; i < 7; i++) {
        const v = document.querySelector<HTMLMediaElement>(selector);
        if (!v || !Number.isFinite(v.duration) || v.paused) return null;
        const start = t.clip.startMs / 1000;
        const end = Math.min(v.duration, (t.clip.endMs ?? v.duration * 1000) / 1000);
        const span = end - start;
        const from = t.seek ? t.seek.toMs / 1000 : start;
        const elapsed = (Date.now() - (t.seek ? t.seek.at : t.startedAt)) / 1000;
        const expected = start + ((from - start + elapsed) % span);
        const off = v.currentTime - expected;
        samples.push(((((off + span / 2) % span) + span) % span) - span / 2);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      samples.sort((a, b) => a - b);
      return samples[3] ?? null;
    },
    { selector, t },
  );
}

/** Where a window's copy plays, sampled for a while (seconds). */
function positions(page: Page, selector: string, ms: number): Promise<number[]> {
  return page.evaluate(
    ({ selector, ms }) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const t = setInterval(() => {
          const v = document.querySelector<HTMLMediaElement>(selector);
          if (v && Number.isFinite(v.duration)) seen.push(v.currentTime);
        }, 50);
        setTimeout(() => {
          clearInterval(t);
          resolve(seen);
        }, ms);
      }),
    { selector, ms },
  );
}

test('a background loops between its points; a jump to a marker lands in step on two screens and the audio player', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-markers-e2e-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder marked clip.webm'), {
    seconds: 8,
    hue: 200,
    tone: 330,
  });
  await importAndGetIds(win, [video]);
  const mediaId =
    (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia()))[0]?.id ?? '';

  // Its Markers button in the media list: start 0:02, end 0:06, a marker at 0:04.
  await win.getByRole('tab', { name: 'Media' }).click();
  await win.getByTestId('media-markers').first().click();
  const dialog = win.getByTestId('markers-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('markers-start').fill('0:02.0');
  await dialog.getByTestId('markers-end').fill('0:06.0');
  const preview = dialog.locator('video');
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await preview.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 4;
  });
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(4, 1);
  await dialog.getByTestId('marker-name').fill('Placeholder chorus');
  await dialog.getByTestId('marker-add').click();
  await expect(dialog.getByTestId('markers-list')).toContainText('Placeholder chorus');
  await expectNoSeriousA11yIssues(win, 'setting markers');
  await dialog.getByTestId('markers-save').click();
  await expect(dialog).toHaveCount(0);
  const kept = await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), mediaId);
  expect(kept).toMatchObject({
    startMs: 2000,
    endMs: 6000,
    markers: [{ name: 'Placeholder chorus', atMs: 4000 }],
  });

  // Two screens and the background, looping.
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fill', loop: true },
      }),
    mediaId,
  );
  const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
  const sound = `audio[data-media-id="${mediaId}"]`;
  const audio = await audioPage(app);
  for (const [page, selector] of [
    [a, picture],
    [b, picture],
    [audio, sound],
  ] as const)
    await expect
      .poll(() =>
        page.evaluate((s) => !(document.querySelector<HTMLMediaElement>(s)?.paused ?? true), selector),
      )
      .toBe(true);
  // Between its points only, going round: never before 0:02 or (much) after 0:06.
  const seen = await positions(a, picture, 6000);
  expect(seen.length).toBeGreaterThan(20);
  expect(Math.min(...seen)).toBeGreaterThan(1.8);
  expect(Math.max(...seen)).toBeLessThan(6.35);
  expect(seen.some((p, i) => i > 0 && p < (seen[i - 1] ?? 0) - 2)).toBe(true);
  const state = async (): Promise<Timing> => {
    const bg = await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
    );
    if (bg?.kind !== 'media' || !bg.clip) throw new Error('no clip');
    return { startedAt: bg.startedAt, clip: bg.clip, ...(bg.seek ? { seek: bg.seek } : {}) };
  };
  /** Wait until the three copies are within two frames of each other and each near the clock. */
  const inStep = async (t: Timing) => {
    const end = Date.now() + 15_000;
    for (;;) {
      const offsets = await Promise.all([
        offsetOf(a, picture, t),
        offsetOf(b, picture, t),
        offsetOf(audio, sound, t),
      ]);
      const known = offsets.filter((o): o is number => o !== null);
      if (
        known.length === 3 &&
        known.every((o) => Math.abs(o) < 0.25) &&
        Math.max(...known) - Math.min(...known) < 2 * FRAME
      )
        return;
      if (Date.now() > end) throw new Error(`Not in step after 15 s. Offsets ${JSON.stringify(offsets)}`);
    }
  };
  await inStep(await state());

  // Jump to the marker from under the live picture: every copy is there, in step.
  const jumps = win.getByTestId('marker-jumps');
  await expect(jumps).toContainText('Placeholder chorus');
  await jumps.getByTestId('marker-jump').click();
  await expect.poll(async () => (await state()).seek?.toMs).toBe(4000);
  await inStep(await state());

  // And from a phone remote's More tab: a tap jumps there again, in step everywhere.
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  try {
    await pairByQr(phone.page, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await phone.page.getByTestId('remote-tab-more').click();
    const remote = phone.page.getByTestId('remote-markers');
    await expect(remote).toContainText('Placeholder chorus');
    await expectNoSeriousA11yIssues(phone.page, 'the remote with markers');
    const before = (await state()).seek?.at ?? 0;
    await remote.getByRole('button', { name: 'Placeholder chorus' }).click();
    await expect.poll(async () => (await state()).seek?.at ?? 0).toBeGreaterThan(before);
    await inStep(await state());
  } finally {
    await phone.close();
  }
  await app.close();
});
