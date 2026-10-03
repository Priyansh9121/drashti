import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  outputPage,
  outputPages,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { makeTestVideo } from './test-media';

/*
 * One picture, one sound: every output shows the same frame of a video, the
 * one audio player plays its sound in step, and nothing else makes a sound.
 */

const FRAME = 1 / 30;
const line = (text: string) => ({ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) });

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/**
 * How far a playing file is from where the shared clock says it should be,
 * in seconds: the median of a few samples. Offsets from the same clock can be
 * compared between windows, whenever each was sampled.
 */
async function offsetOf(page: Page, selector: string, startedAt: number): Promise<number | null> {
  return page.evaluate(
    async ({ selector, startedAt }) => {
      const samples: number[] = [];
      for (let i = 0; i < 7; i++) {
        const v = document.querySelector<HTMLMediaElement>(selector);
        if (!v || !Number.isFinite(v.duration) || v.paused) return null;
        const d = v.duration;
        const expected = ((Date.now() - startedAt) / 1000) % d;
        const off = v.currentTime - expected;
        samples.push(((((off + d / 2) % d) + d) % d) - d / 2);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      samples.sort((a, b) => a - b);
      return samples[3] ?? null;
    },
    { selector, startedAt },
  );
}

/** Media elements that could be making sound in a page: playing, not muted, not silent. */
const soundingIn = (page: Page) =>
  page.evaluate(
    () =>
      Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video')).filter(
        (m) => !m.paused && !m.muted && m.volume > 0,
      ).length,
  );

test('outputs and the sound stay in step, a reloaded output rejoins, and only the audio player makes sound', async () => {
  // Two outputs on a one-screen machine: windowed, with one pretend extra display.
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-sound-'));
  const clip = await makeTestVideo(win, join(dir, 'Placeholder tone.webm'), {
    seconds: 4,
    tone: 440,
    hue: 120,
  });
  const show = join(dir, 'Placeholder Sound.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-SOUND',
      groups: [
        {
          name: 'Verse',
          slides: [
            { background: { path: clip, kind: 'video', loop: true }, text: [line('Placeholder sound one')] },
            { text: [line('Placeholder sound two')] },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const out of [a, b])
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  const audio = await audioPage(app);

  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );
  const startedAt = await win.evaluate(async () => {
    const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
    return bg?.kind === 'media' ? bg.startedAt : 0;
  });
  const mediaId = await win.evaluate(async () => {
    const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
    return bg?.kind === 'media' ? bg.mediaId : '';
  });
  const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
  const sound = `audio[data-media-id="${mediaId}"]`;
  for (const out of [a, b]) await expect(out.locator(picture)).toHaveAttribute('data-state', 'ready');
  await expect(audio.locator(sound)).toHaveCount(1);

  /** How each window's media element is doing, for a failure message. */
  const describe = (pages: Page[], selectors: string[]) =>
    Promise.all(
      pages.map((p, i) =>
        p.evaluate((selector) => {
          const v = document.querySelector<HTMLMediaElement>(selector);
          return v
            ? `t=${v.currentTime.toFixed(2)} d=${v.duration.toFixed(2)} paused=${v.paused} ready=${v.readyState} rate=${v.playbackRate}`
            : 'missing';
        }, selectors[i] ?? ''),
      ),
    );

  /**
   * Wait until the windows are within two frames of each other (and each
   * within a quarter of a second of the clock), then return their offsets.
   * On a slow or stalling machine they may all lag the clock a little
   * together; what the audience sees is whether the screens agree.
   */
  const inStep = async (pages: Page[], selectors: string[]) => {
    let offsets: (number | null)[] = [];
    const agree = async () => {
      offsets = await Promise.all(pages.map((p, i) => offsetOf(p, selectors[i] ?? '', startedAt)));
      const known = offsets.filter((o): o is number => o !== null);
      return (
        known.length === pages.length &&
        known.every((o) => Math.abs(o) < 0.25) &&
        Math.max(...known) - Math.min(...known) < 2 * FRAME
      );
    };
    const end = Date.now() + 15_000;
    while (!(await agree())) {
      if (Date.now() > end) {
        const states = await describe(pages, selectors);
        throw new Error(`Not in step after 15 s. Offsets ${JSON.stringify(offsets)}; ${states.join(' | ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return offsets as number[];
  };

  // Both outputs show the same frame (within a frame or two), and the sound is with them.
  const [oa = NaN, ob = NaN, oSound = NaN] = await inStep([a, b, audio], [picture, picture, sound]);
  expect(Math.abs(oa - ob), `outputs ${oa.toFixed(3)} and ${ob.toFixed(3)} s off the clock`).toBeLessThan(
    2 * FRAME,
  );
  expect(Math.abs(oa - oSound), `sound ${oSound.toFixed(3)} s off the clock`).toBeLessThan(2 * FRAME);

  // A reloaded output joins the video where the others are.
  await b.reload();
  await expect(b.locator(picture)).toHaveAttribute('data-state', 'ready');
  const [ra = NaN, rb = NaN] = await inStep([a, b], [picture, picture]);
  expect(Math.abs(ra - rb), 'reloaded output against the other').toBeLessThan(2 * FRAME);

  // Only the audio player makes sound: outputs and the preview are muted.
  expect(await soundingIn(audio)).toBe(1);
  for (const page of [win, a, b]) expect(await soundingIn(page)).toBe(0);
  const audible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      page: new URL(w.webContents.getURL()).pathname.split('/').pop() ?? '',
      audible: w.webContents.isCurrentlyAudible(),
    })),
  );
  expect(audible.filter((w) => w.audible && w.page !== 'audio.html')).toEqual([]);

  // The operator window crashing does not cut the sound: the same playback carries on.
  const loadedAt = await audio.evaluate(() => performance.timeOrigin);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))
      ?.webContents.forcefullyCrashRenderer();
  });
  const carriedOn = await audio.evaluate(async (selector) => {
    const el = document.querySelector<HTMLMediaElement>(selector);
    if (!el) return -1;
    const before = el.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return (((el.currentTime - before) % el.duration) + el.duration) % el.duration;
  }, sound);
  expect(carriedOn).toBeGreaterThan(0.4);
  expect(await audio.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
  expect(await soundingIn(audio)).toBe(1);

  await app.close();
});

test('only the audio player may see sound outputs; the choice is remembered, and a missing one falls back', async () => {
  const { app, userData } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  const audio = await audioPage(app);
  const outputsSeenBy = (page: Page) =>
    page.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => d.deviceId),
    );
  // The audio player can tell the outputs apart once it has looked; the operator window and the outputs cannot.
  await expect
    .poll(
      async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.audio.getOutput())).checked,
    )
    .toBe(true);
  await setUpScreen(win);
  const output = await outputPage(app);
  for (const page of [win, output]) expect((await outputsSeenBy(page)).every((id) => id === '')).toBe(true);
  await win.reload();
  expect((await outputsSeenBy(win)).every((id) => id === '')).toBe(true);

  // Recording, the camera and every other permission stay refused, even to the audio player.
  for (const page of [win, audio]) {
    const asked = await page.evaluate(async () => {
      const media = async (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints).then(
          (stream) => {
            for (const t of stream.getTracks()) t.stop();
            return 'granted';
          },
          (e: unknown) => (e instanceof Error ? e.name : 'refused'),
        );
      const states: Record<string, string> = {};
      for (const name of ['notifications', 'geolocation', 'microphone', 'camera', 'midi', 'clipboard-read']) {
        states[name] = await navigator.permissions.query({ name: name as PermissionName }).then(
          (s) => s.state,
          () => 'unsupported',
        );
      }
      return { microphone: await media({ audio: true }), camera: await media({ video: true }), states };
    });
    expect(asked.microphone).not.toBe('granted');
    expect(asked.camera).not.toBe('granted');
    // MIDI is the operator window's alone (Session 11: a controller's pads), never SysEx; the rest stay refused.
    for (const [name, state] of Object.entries(asked.states))
      if (page === win && name === 'midi') expect(state).toBe('granted');
      else expect([name, state]).not.toEqual([name, 'granted']);
  }

  // Choosing an output in Screens > Sound output moves the sound there, and it is remembered.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const select = win.getByRole('combobox', { name: 'Sound output' });
  await expect(select).toBeVisible();
  const choices = await select
    .locator('option')
    .evaluateAll((options) =>
      (options as HTMLOptionElement[])
        .map((o) => ({ value: o.value, label: o.label }))
        .filter((o) => o.value !== ''),
    );
  const pick = choices[0];
  if (pick) {
    await select.selectOption(pick.value);
    await expect.poll(() => audio.evaluate(() => document.body.dataset['sinkId'])).toBe(pick.value);
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'No sound outputs on this machine; only the fallback is checked.',
    });
  }

  // An output that is not connected (the mixer unplugged): sound falls back to the default, and the operator is told.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.audio.setOutput({
      id: 'placeholder-mixer-id',
      label: 'Placeholder Mixer',
    }),
  );
  await expect(win.getByTestId('sound-warning')).toHaveText('Sound output "Placeholder Mixer" not connected');
  await expect.poll(() => audio.evaluate(() => document.body.dataset['output'])).toBe('missing');
  expect(await audio.evaluate(() => document.body.dataset['sinkId'])).toBe('');
  await app.close();

  // After a restart the choice is remembered, and still missing: the operator sees it at once.
  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  const status = await win2.evaluate(() => (globalThis as PageGlobals).drashti.audio.getOutput());
  expect(status.chosen).toEqual({ id: 'placeholder-mixer-id', label: 'Placeholder Mixer' });
  await expect(win2.getByTestId('sound-warning')).toBeVisible();
  const audio2 = await audioPage(again.app);
  await expect.poll(() => audio2.evaluate(() => document.body.dataset['output'])).toBe('missing');
  await again.app.close();
});

test("an audio cue plays on the audio layer with the cue's volume and looping; Clear audio stops it", async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-cue-'));
  const tune = await makeTestVideo(win, join(dir, 'Placeholder tune.webm'), {
    seconds: 2,
    tone: 330,
    width: 64,
    height: 36,
  });
  const show = join(dir, 'Placeholder Dhun.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-DHUN',
      groups: [
        {
          name: 'Verse',
          // The audio cue in these files plays at 0.8 volume and loops.
          slides: [
            { audio: tune, text: [line('Placeholder dhun one')] },
            { text: [line('Placeholder dhun two')] },
          ],
        },
      ],
    }),
  );
  await importAndGetIds(win, [show]);
  const audio = await audioPage(app);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Dhun/ })
    .click();
  await expect(win.getByTestId('slide-thumb').nth(0).getByTestId('thumb-audio')).toHaveText(
    'Placeholder audio',
  );
  await expect(win.getByTestId('slide-thumb').nth(1).getByTestId('thumb-audio')).toHaveCount(0);

  await win.getByTestId('slide-thumb').nth(0).click();
  const cue = audio.locator('audio[data-key^="audio:"]');
  await expect(cue).toHaveCount(1);
  await expect
    .poll(() =>
      cue.evaluate((el: HTMLAudioElement) => ({
        playing: !el.paused,
        volume: el.volume,
        loop: el.loop,
        muted: el.muted,
      })),
    )
    .toEqual({ playing: true, volume: 0.8, loop: true, muted: false });
  await expect(win.getByTestId('audio-status')).toHaveText('Placeholder audio');
  const key = await cue.getAttribute('data-key');

  // A slide without sound leaves it playing: the same playback, past the end of the 2 s file (it loops).
  await win.keyboard.press('ArrowRight');
  await expect(win.getByTestId('live-text')).toContainText('slide 2 of 2');
  await expect(cue).toHaveAttribute('data-key', key ?? '');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(await cue.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true);
  expect(await soundingIn(win)).toBe(0);

  // Clear audio (F6) stops it; the slide stays up.
  await win.keyboard.press('F6');
  await expect(cue).toHaveCount(0);
  await expect(win.getByTestId('audio-status')).toHaveCount(0);
  const layers = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers,
  );
  expect(layers.audio).toBeNull();
  expect(layers.slide?.slideIndex).toBe(1);
  await app.close();
});
