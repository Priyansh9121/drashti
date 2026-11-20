import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, openLibrary, operatorPage, operatorReady } from './helpers';
import { testFfmpeg } from './stream-helpers';

interface Analysis {
  state: string;
  note: string | null;
  message: string | null;
  durationMs: number;
  waveform: { durationMs: number; peaks: [number, number][] } | null;
  scenes: number[];
  storyboard: string | null;
}
interface AnalysisGlobals {
  drashti: {
    media: {
      videoAnalysis(
        id: string,
        audio?: number | null,
        retry?: boolean,
      ): Promise<{ ok: true; analysis: Analysis } | { ok: false; message: string }>;
    };
  };
}

/** Generated red/blue cut with a changing synthetic tone; no private material. */
function makeVideo(path: string): void {
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled FFmpeg is required.');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-f',
    'lavfi',
    '-i',
    'color=red:s=320x180:r=25:d=4',
    '-f',
    'lavfi',
    '-i',
    'color=blue:s=320x180:r=25:d=4',
    '-f',
    'lavfi',
    '-i',
    'sine=f=120:r=8000:d=8',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-threads',
    '1',
    path,
  ];
  const made = spawnSync(ffmpeg, args);
  if (made.status !== 0) throw new Error('Could not generate the placeholder cut video.');
}

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('idle analysis prepares a waveform, one cached strip and suggested cuts without changing saved markers', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-analysis-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // This assertion is also the baseline red: the old app has no analysis service.
    expect(
      await win.evaluate(() => typeof (globalThis as unknown as AnalysisGlobals).drashti.media.videoAnalysis),
    ).toBe('function');
    const file = join(dir, 'Placeholder cut.mp4');
    makeVideo(file);
    const original = digest(file);
    const ids = await importAndGetIds(win, [file]);
    const id = ids[0];
    if (!id) throw new Error('Placeholder video was not imported.');
    const points = {
      startMs: 500,
      endMs: 7000,
      markers: [{ id: 'own-marker', name: 'Placeholder point', atMs: 2200 }],
    };
    expect(
      await win.evaluate(
        ({ id, points }) => (globalThis as PageGlobals).drashti.media.setMarkers(id, points),
        { id, points },
      ),
    ).toMatchObject({ ok: true });
    await app.evaluate(() => {
      const hook = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
      if (!hook) throw new Error('The on-air gate hook is missing.');
      hook(true);
    });
    const get = () =>
      win.evaluate((id) => (globalThis as unknown as AnalysisGlobals).drashti.media.videoAnalysis(id, 0), id);
    expect(await get()).toMatchObject({
      ok: true,
      analysis: { state: 'waiting', waveform: null, storyboard: null },
    });
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    const row = win.getByTestId('media-row').filter({ hasText: 'Placeholder cut' });
    await row.hover();
    const slider = row.getByRole('slider', { name: /Browse frames/ });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('aria-valuetext', /Waits while the stream/);
    await app.evaluate(() =>
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false),
    );
    await expect
      .poll(async () => {
        const result = await get();
        if (result.ok && result.analysis.state === 'failed')
          throw new Error(result.analysis.message ?? 'Analysis failed.');
        return result.ok ? result.analysis.state : result.message;
      })
      .toBe('ready');
    const result = await get();
    if (!result.ok) throw new Error(result.message);
    const ready = result.analysis;
    expect(ready.waveform?.peaks.length).toBeGreaterThan(100);
    expect(ready.waveform?.peaks.length).toBeLessThanOrEqual(4096);
    expect(ready.waveform?.peaks.some(([low, high]) => low < -0.01 && high > 0.01)).toBe(true);
    expect(ready.scenes.some((at) => Math.abs(at - 4000) <= 80)).toBe(true);
    expect(ready.storyboard).toMatch(/^data:image\/jpeg;base64,/u);
    expect(await get()).toEqual(result);
    expect(await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), id)).toEqual(
      points,
    );
    expect(digest(file)).toBe(original);
    await expect(slider).toHaveCSS('background-image', /data:image\/jpeg;base64/);
    await slider.focus();
    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '7.6');
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(await row.locator('video,audio').count()).toBe(0);
    await expectNoSeriousA11yIssues(win, 'cached video hover preview');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
