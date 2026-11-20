import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, openLibrary, operatorPage, operatorReady } from './helpers';
import { streamPage, testFfmpeg } from './stream-helpers';
import { audioPage, dispatch } from './time-bar-helpers';

/*
 * Sound and picture…'s tone (alpha.20: the owner's "Yes, all A" to Q60-39 P2 A): a sound's own Bass and Treble, set in
 * its window from its right-click menu in Media, heard alike in the hall (the audio player's meter, two bands: low and
 * high) and on the stream (the stream's page mixing Drashti's own sound, its meter the same), never stopping or moving
 * the sound. A generated sound of a 50 Hz and an 8 kHz tone only; nothing is streamed anywhere.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

/** 2 minutes of a 50 Hz and an 8 kHz tone together, as AAC. */
function twoTones(file: string): string {
  const r = spawnSync(
    ffmpeg ?? '',
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
      ...['-f', 'lavfi', '-i', 'sine=f=50:r=48000:d=120', '-f', 'lavfi', '-i', 'sine=f=8000:r=48000:d=120'],
      ...[
        '-filter_complex',
        '[0][1]amix=inputs=2:normalize=0,volume=0.3',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        file,
      ],
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return file;
}

/** A page's two-band meter now, the median of a few readings: [low, high] in dB. */
async function bands(page: Page): Promise<[number, number]> {
  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = 0; i < 7; i++) {
    // No meter yet reads as silence, never as 0 dB.
    const text = await page.locator('body').getAttribute('data-bands');
    const [low = -200, high = -200] = text ? text.split(',').map(Number) : [];
    lows.push(low);
    highs.push(high);
    await letTimePass(page, 120, 'the meter reads again');
  }
  const mid = (a: number[]) => a.sort((x, y) => x - y)[3] ?? -200;
  return [mid(lows), mid(highs)];
}

test('Bass and Treble from Sound and picture…: the hall’s and the stream’s low band up 10 dB or more, the high one down, the sound never stopped or moved', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-sound-tone-'));
    const [id = ''] = await importAndGetIds(win, [twoTones(join(dir, 'Placeholder two tones.m4a'))]);
    expect(id).not.toBe('');
    // Drashti's own sound in the stream's page (its preview kept running: nothing is sent anywhere).
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const { profiles, activeId } = await d.stream.profiles();
      const p = profiles.find((x) => x.id === activeId);
      if (!p) throw new Error('no profile');
      const saved = await d.stream.saveProfile(p.id, {
        name: p.name,
        url: p.url,
        preset: p.preset,
        camera: null,
        sound: null,
        soundDelayMs: 0,
        mixOwnSound: true,
      });
      if (!saved.ok) throw new Error(saved.message);
      await d.stream.watchPreview(true);
    });
    const program = await streamPage(app);
    expect(
      (
        await dispatch(win, {
          type: 'playAudio',
          audio: { id: `sound:${id}`, title: 'Placeholder two tones', mediaId: id, volume: 1, loop: true },
        })
      ).ok,
    ).toBe(true);
    const audio = await audioPage(app);
    const heard = audio.locator(`audio[data-media-id="${id}"]`);
    await expect(heard).toHaveCount(1);
    await expect.poll(async () => (await bands(audio))[0], { timeout: 20_000 }).toBeGreaterThan(-80);
    await expect.poll(async () => (await bands(program))[0], { timeout: 20_000 }).toBeGreaterThan(-80);
    const [hallLow, hallHigh] = await bands(audio);
    const [streamLow, streamHigh] = await bands(program);

    // Its window, from its right-click menu in Media.
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    await win
      .getByTestId('media-item')
      .filter({ hasText: 'Placeholder two tones' })
      .click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Sound and picture…' }).click();
    const dialog = win.getByTestId('sound-picture');
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yIssues(win, 'Sound and picture…');
    const startedAt = await heard.evaluate((el: HTMLMediaElement) => el.currentTime);
    const wall = Date.now();
    await dialog.getByLabel('Bass').fill('12');
    await dialog.getByLabel('Treble').fill('-12');
    await expect(dialog.getByTestId('sound-picture-bassDb-words')).toHaveText('+12 dB');
    await expect(dialog.getByTestId('sound-picture-trebleDb-words')).toHaveText('−12 dB');

    // The hall and the stream alike: the low band up 10 dB or more, the high band down.
    await expect
      .poll(async () => (await bands(audio))[0] - hallLow, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(10);
    await expect
      .poll(async () => (await bands(audio))[1] - hallHigh, { timeout: 15_000 })
      .toBeLessThanOrEqual(-6);
    await expect
      .poll(async () => (await bands(program))[0] - streamLow, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(10);
    await expect
      .poll(async () => (await bands(program))[1] - streamHigh, { timeout: 15_000 })
      .toBeLessThanOrEqual(-6);
    // Never stopped or moved: the same element, its time on as far as the clock is (within a quarter of a second).
    const now = await heard.evaluate((el: HTMLMediaElement) => el.currentTime);
    expect(Math.abs(now - startedAt - (Date.now() - wall) / 1000)).toBeLessThan(0.25);
    expect((await dispatch(win, { type: 'clearLayer', layer: 'audio' })).ok).toBe(true);
  } finally {
    await app.close();
  }
});
