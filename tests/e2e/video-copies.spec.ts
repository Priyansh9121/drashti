import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';

interface CopyJob {
  id: string;
  state: string;
  path: string | null;
  added: boolean;
  message: string | null;
}
interface CopiesGlobals {
  drashti: {
    media: {
      proxyStatus(
        id: string,
        retry?: boolean,
      ): Promise<
        | {
            ok: true;
            proxy: {
              state: string;
              required: boolean;
              readyMediaId: string | null;
              width: number | null;
              height: number | null;
              message: string | null;
            };
          }
        | { ok: false; message: string }
      >;
      clipExport(request: {
        mediaId: string;
        startMs: number;
        endMs: number;
        frame: 'original';
        shape: 'vertical';
        container: 'mp4';
        addToLibrary: boolean;
        revision: null;
      }): Promise<{ ok: true; job: CopyJob | null } | { ok: false; message: string }>;
      clipExports(): Promise<CopyJob[]>;
      stopClipExport(id: string): Promise<boolean>;
    };
  };
}
function ffmpeg(args: string[]) {
  const file = testFfmpeg();
  if (!file) throw new Error('The bundled FFmpeg is required.');
  return spawnSync(
    file,
    ['-hide_banner', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1', ...args],
    { windowsHide: true },
  );
}
function generated(path: string, large = false) {
  const made = ffmpeg([
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=0x336699:s=${large ? '3840x2160' : '160x90'}:r=25:d=${large ? '0.6' : '2'}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '1',
    path,
  ]);
  expect(made.status, made.error?.message ?? made.stderr.toString()).toBe(0);
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('idle lighter copies and vertical clip exports keep the originals and stop at the on-air gate', async () => {
  const { app } = await launchApp({
    DRASHTI_TEST_ON_AIR_HOOK: '1',
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
  });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-copies-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(
      await win.evaluate(() => typeof (globalThis as unknown as CopiesGlobals).drashti.media.clipExport),
    ).toBe('function');
    expect(
      await win.evaluate(() => typeof (globalThis as unknown as CopiesGlobals).drashti.media.proxyStatus),
    ).toBe('function');
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    await app.evaluate(() => {
      const hook = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
      if (!hook) throw new Error('The on-air gate hook is missing.');
      hook(true);
    });
    const large = join(dir, 'Placeholder large.mp4');
    const source = join(dir, 'Placeholder clip.mp4');
    generated(large, true);
    generated(source);
    const hashes = [digest(large), digest(source)];
    const ids = await importAndGetIds(win, [large, source]);
    const [largeId, id] = ids;
    if (!largeId || !id) throw new Error('The generated videos were not imported.');
    const points = {
      startMs: 100,
      endMs: 1900,
      markers: [{ id: 'own-marker', name: 'Placeholder point', atMs: 800 }],
    };
    expect(
      await win.evaluate(
        ({ id, points }) => (globalThis as PageGlobals).drashti.media.setMarkers(id, points),
        { id, points },
      ),
    ).toMatchObject({ ok: true });
    const proxy = () =>
      win.evaluate((id) => (globalThis as unknown as CopiesGlobals).drashti.media.proxyStatus(id), largeId);
    expect(await proxy()).toMatchObject({ ok: true, proxy: { state: 'checking' } });
    const destination = join(dir, 'Placeholder vertical.mp4');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, destination);
    const request = {
      mediaId: id,
      startMs: 350,
      endMs: 1750,
      frame: 'original' as const,
      shape: 'vertical' as const,
      container: 'mp4' as const,
      addToLibrary: true,
      revision: null,
    };
    const start = () =>
      win.evaluate(
        (request) => (globalThis as unknown as CopiesGlobals).drashti.media.clipExport(request),
        request,
      );
    const stopped = await start();
    if (!stopped.ok || !stopped.job) throw new Error(stopped.ok ? 'No export was queued.' : stopped.message);
    expect(stopped.job.state).toBe('waiting');
    expect(existsSync(destination)).toBe(false);
    expect(
      await win.evaluate(
        (id) => (globalThis as unknown as CopiesGlobals).drashti.media.stopClipExport(id),
        stopped.job.id,
      ),
    ).toBe(true);
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    await win.getByTestId('media-item').filter({ hasText: 'Placeholder clip' }).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Edit Video…', exact: true }).click();
    const editor = win.getByTestId('edit-video');
    await expect(editor).toBeVisible();
    await editor.getByLabel('Start (seconds)', { exact: true }).fill('0.350');
    await editor.getByLabel('End (seconds)', { exact: true }).fill('1.750');
    await editor.getByRole('button', { name: 'Preparation and export', exact: true }).click();
    await editor.getByLabel('Picture and sound').selectOption('original');
    await editor.getByLabel('Clip shape').selectOption('vertical');
    await editor.getByLabel('Also add the clip to Media').check();
    await editor.getByRole('button', { name: 'Export clip…', exact: true }).click();
    await expect(editor.locator('[data-testid="clip-export-job"][data-state="waiting"]')).toBeVisible();
    const queued = await win.evaluate(() =>
      (globalThis as unknown as CopiesGlobals).drashti.media.clipExports(),
    );
    const accepted = { job: queued.find((job) => job.id !== stopped.job?.id && job.state === 'waiting') };
    if (!accepted.job) throw new Error('The editor did not queue its export.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await win.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(accepted.job.state).toBe('waiting');
    expect(existsSync(destination)).toBe(false);
    await app.evaluate(() =>
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false),
    );
    await expect
      .poll(async () => {
        const jobs = await win.evaluate(() =>
          (globalThis as unknown as CopiesGlobals).drashti.media.clipExports(),
        );
        const job = jobs.find((job) => job.id === accepted.job?.id);
        if (job?.state === 'failed') throw new Error(job.message ?? 'The export failed.');
        return job?.state;
      })
      .toBe('done');
    const jobs = await win.evaluate(() =>
      (globalThis as unknown as CopiesGlobals).drashti.media.clipExports(),
    );
    expect(jobs.find((job) => job.id === accepted.job?.id)).toMatchObject({ path: destination, added: true });
    expect(jobs.find((job) => job.id === stopped.job?.id)?.state).toBe('stopped');
    const read = ffmpeg([
      '-loglevel',
      'info',
      '-i',
      destination,
      '-map',
      '0:V:0',
      '-an',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ]);
    expect(read.status, read.stderr.toString()).toBe(0);
    expect(read.stderr.toString()).toMatch(/1080x1920/u);
    expect(read.stderr.toString()).toMatch(/Duration: 00:00:01\.4/u);
    await expect
      .poll(async () => {
        const result = await proxy();
        if (!result.ok || result.proxy.state === 'failed')
          throw new Error(result.ok ? (result.proxy.message ?? 'The lighter copy failed.') : result.message);
        return result.proxy.state;
      })
      .toBe('ready');
    const ready = await proxy();
    expect(ready).toMatchObject({ ok: true, proxy: { required: true, width: 1920, height: 1080 } });
    if (ready.ok) expect(ready.proxy.readyMediaId).not.toBe(largeId);
    expect(await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), id)).toEqual(
      points,
    );
    expect([digest(large), digest(source)]).toEqual(hashes);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
