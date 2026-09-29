import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  outputPage,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * Restart recovery: after an unexpected stop, the next start puts the same
 * slide, background and black-out back on the screens by itself and tells
 * the operator; after a clean quit it starts with nothing live.
 */

const line = (text: string) => ({ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) });

test('after a crash the same slide, background and black-out come back; after a clean quit nothing is live', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-'));
  const still = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), { width: 160, height: 90 });
  const show = join(dir, 'Placeholder Recovery.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-RECOVERY',
      groups: [
        {
          name: 'Verse',
          slides: [
            { background: { path: still, kind: 'image' }, text: [line('Placeholder recovery one')] },
            { text: [line('Placeholder recovery two')] },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  await setUpScreen(win);
  await outputPage(first.app);
  const dispatch = (command: Parameters<PageGlobals['drashti']['engine']['dispatch']>[0]) =>
    win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
  await dispatch({ type: 'goLive', presentationId, slideIndex: 0 });
  await dispatch({ type: 'goLive', presentationId, slideIndex: 1 });
  await dispatch({ type: 'setBlackout', on: true });

  // Saved as it changes (in the background): wait until the file has it, then stop Drashti dead.
  const stateFile = join(first.userData, 'live-state.json');
  await expect
    .poll(() => {
      if (!existsSync(stateFile)) return null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        slide: { slideIndex: number } | null;
        blackout: boolean;
      };
      return [saved.slide?.slideIndex, saved.blackout];
    })
    .toEqual([1, true]);
  await killApp(first.app);

  // The next start puts it all back by itself, and says so.
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  const output = await outputPage(second.app);
  await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder recovery two');
  await expect(output.locator('[data-layer="background"] img')).toHaveAttribute('data-state', 'ready');
  await expect(output.getByTestId('blackout')).toBeVisible();
  const notice = win2.getByTestId('recovery-notice');
  await expect(notice).toContainText(
    'Drashti stopped unexpectedly and has put back what was live: "Placeholder Recovery", slide 2, the background and black-out.',
  );
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toHaveCount(0);

  // A clean quit: the next start has nothing live, and nothing to say.
  await second.app.close();
  const third = await relaunchApp(first.userData);
  const win3 = await operatorPage(third.app);
  await expect(win3.getByTestId('presentation-list').getByRole('button').first()).toBeVisible();
  const layers = await win3.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { slide: s.layers.slide, background: s.layers.background, blackout: s.blackout };
  });
  expect(layers).toEqual({ slide: null, background: null, blackout: false });
  expect(await win3.evaluate(() => (globalThis as PageGlobals).drashti.app.recovery())).toBeNull();
  await expect(win3.getByTestId('recovery-notice')).toHaveCount(0);
  await third.app.close();
});

test('after a crash a running timer, a message and the sound come back, carrying on where they were', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-recovery-show-'));
  const tune = await makeTestVideo(win, join(dir, 'Placeholder tune.webm'), {
    seconds: 3,
    tone: 300,
    width: 64,
    height: 36,
  });
  const [tuneId = ''] = await importAndGetIds(win, [tune]);
  await setUpScreen(win);
  await outputPage(first.app);
  // A countdown, running; a message with it in; the tune on the audio layer.
  const started = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.timers.create({
      name: 'Placeholder start',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    if (!made.ok) throw new Error(made.message);
    await d.engine.dispatch({ type: 'startTimer', timerId: made.id });
    await d.engine.dispatch({
      type: 'showMessage',
      message: {
        id: 'placeholder-message',
        text: 'Placeholder sabha starts in [timer]',
        parts: [
          { kind: 'text', text: 'Placeholder sabha starts in ' },
          { kind: 'timer', timerId: made.id },
        ],
      },
    });
    await d.engine.dispatch({
      type: 'playAudio',
      audio: { id: 'placeholder-tune', title: 'Placeholder tune', mediaId, volume: 1, loop: true },
    });
    const s = (await d.engine.snapshot()).state;
    return { timer: s.timers[0]?.startedAt ?? 0, audio: s.layers.audio?.startedAt ?? 0 };
  }, tuneId);
  // Saved (within a quarter of a second), then stopped dead.
  const stateFile = join(first.userData, 'live-state.json');
  await expect
    .poll(() => {
      if (!existsSync(stateFile)) return null;
      const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
        messages?: unknown[];
        timers?: unknown[];
      };
      return [saved.messages?.length, saved.timers?.length];
    })
    .toEqual([1, 1]);
  await killApp(first.app);

  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  const output = await outputPage(second.app);
  // The message is back, with the timer counting on from where it started (below 5:00 now).
  const banner = output.locator('[data-layer="messages"]');
  await expect(banner).toContainText('Placeholder sabha starts in 4:');
  const back = await win2.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return { timer: s.timers[0]?.startedAt ?? -1, audio: s.layers.audio?.startedAt ?? -1 };
  });
  expect(back).toEqual(started);
  // The sound plays again in the audio player, from where it would be now.
  await expect.poll(() => second.app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const audio = second.app.windows().find((w) => w.url().includes('audio.html'));
  await expect
    .poll(() =>
      audio?.locator('audio[data-key]').evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0),
    )
    .toBe(true);
  await expect(win2.getByTestId('recovery-notice')).toContainText('the sound, a message and a timer');
  await second.app.close();
});
