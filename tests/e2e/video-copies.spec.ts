import { expect, test, type Locator } from '@playwright/test';
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
import { expectNoSeriousA11yIssues } from './a11y';

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
        frame: 'original' | 'edited';
        shape: 'vertical' | 'source';
        container: 'mp4';
        addToLibrary: boolean;
        revision: number | null;
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
/**
 * Every control of Edit Video's export section stands at least 8 px clear of the others: its three choices, the
 * Also add the clip to Media box and Export clip… (in alpha.20 the box ran right up to the button, with no gap).
 */
async function expectExportControlsApart(editor: Locator, what: string): Promise<void> {
  const section = editor.getByTestId('video-clip-export');
  await expect(section).toBeVisible();
  const close = await section.evaluate((root) => {
    const controls = [
      ...root.querySelectorAll<HTMLElement>('select, button, label:has(> input[type="checkbox"])'),
    ]
      .filter((el) => !el.closest('ul'))
      .map((el) => ({
        name: ((el instanceof HTMLSelectElement ? el.labels[0]?.textContent : el.textContent) ?? '').trim(),
        box: el.getBoundingClientRect(),
      }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const out: string[] = [];
    for (const [i, a] of controls.entries())
      for (const b of controls.slice(i + 1)) {
        const gap = Math.max(
          b.box.left - a.box.right,
          a.box.left - b.box.right,
          b.box.top - a.box.bottom,
          a.box.top - b.box.bottom,
        );
        if (gap < 8) out.push(`“${a.name}” and “${b.name}” are ${gap.toFixed(1)} px apart`);
      }
    return out;
  });
  expect(close, what).toEqual([]);
}

test('idle lighter copies and vertical clip exports keep the originals and stop at the on-air gate', async () => {
  const { app, userData } = await launchApp({
    DRASHTI_TEST_ON_AIR_HOOK: '1',
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_TEST_MEDIA_DELAY_MS: '2000',
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
    const largePoints = {
      startMs: 40,
      endMs: 560,
      markers: [{ id: 'large-own', name: 'Placeholder point', atMs: 200 }],
    };
    expect(
      await win.evaluate(
        ({ id, points }) => (globalThis as PageGlobals).drashti.media.setMarkers(id, points),
        { id: largeId, points: largePoints },
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
    const end = editor.getByLabel('End (seconds)', { exact: true });
    const preview = editor.getByTestId('edit-video-preview');
    await expect(end, 'the delayed header has not supplied the default end yet').toHaveValue('0');
    // The header owns the initial End value. Let it arrive before selecting either input, so it cannot replace
    // Playwright's selection between that selection and its separate text insertion (CI x67-1121-132910-14446).
    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(1);
    await expect(end).toHaveValue('2');
    await editor.getByLabel('Start (seconds)', { exact: true }).fill('0.350');
    // Playwright fill selects a number input, then inserts text in a separate call. Force its real race:
    // metadata supplies the default end after selection and before that text arrives.
    await end.selectText();
    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(1);
    await expect(end).toHaveValue('2');
    await win.keyboard.insertText('1.750');
    await editor.getByRole('button', { name: 'Preparation and export', exact: true }).click();
    await editor.getByLabel('Picture and sound').selectOption('original');
    await editor.getByLabel('Clip shape').selectOption('vertical');
    await editor.getByLabel('Also add the clip to Media').check();
    await expectExportControlsApart(editor, 'the export section keeps its controls apart');
    await expectNoSeriousA11yIssues(win, 'clip export controls');
    await editor.getByRole('button', { name: 'Export clip…', exact: true }).click();
    await expect(editor.locator('[data-testid="clip-export-job"][data-state="waiting"]')).toBeVisible();
    const queued = await win.evaluate(() =>
      (globalThis as unknown as CopiesGlobals).drashti.media.clipExports(),
    );
    const accepted = { job: queued.find((job) => job.id !== stopped.job?.id && job.state === 'waiting') };
    if (!accepted.job) throw new Error('The editor did not queue its export.');
    const pending = JSON.parse(
      readFileSync(join(userData, 'Media', 'video-clip-clips.json'), 'utf8'),
    ) as unknown;
    expect(pending, 'the accepted editor request keeps the exact source-time bounds').toMatchObject([
      { request },
    ]);
    const originalPath = join(userData, 'Media', hashes[1]?.slice(0, 2) ?? '', `${hashes[1] ?? ''}.mp4`);
    const sourceRead = ffmpeg(['-i', originalPath]);
    expect(sourceRead.stderr.toString(), 'the immutable imported source has its full length').toMatch(
      /Duration: 00:00:02\.00/u,
    );
    await test.info().attach('Queued export source and bounds', {
      body: JSON.stringify({ pending, originalRead: sourceRead.stderr.toString() }, null, 2),
      contentType: 'application/json',
    });
    await test
      .info()
      .attach('Queued clip export', { body: await editor.screenshot(), contentType: 'image/png' });
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
        if (job?.state === 'failed')
          throw new Error(
            `${job.message ?? 'The export failed.'} Queued: ${JSON.stringify(pending)} Source: ${/Duration:[^\r\n]+/u.exec(sourceRead.stderr.toString())?.[0] ?? 'no duration'}`,
          );
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
    if (!ready.ok || !ready.proxy.readyMediaId) throw new Error('The lighter copy has no immutable file.');
    expect(
      await win.evaluate(
        (id) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({
            type: 'setBackground',
            background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
          }),
        largeId,
      ),
    ).toMatchObject({ ok: true });
    const shown = await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
    );
    expect(shown).toMatchObject({
      mediaId: ready.proxy.readyMediaId,
      clip: { startMs: 40, endMs: 560 },
      marks: largePoints.markers,
    });
    expect(await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), id)).toEqual(
      points,
    );
    expect([digest(large), digest(source)]).toEqual(hashes);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saved edits export full-quality picture, selected sound and speed once from the original', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-edited-export-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(
      await win.evaluate(() => typeof (globalThis as unknown as CopiesGlobals).drashti.media.clipExport),
    ).toBe('function');
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    const original = join(dir, 'Placeholder full quality.mp4');
    const made = ffmpeg([
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=0x336699:s=3840x2160:r=25:d=1.6',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000:d=1.6',
      '-f',
      'lavfi',
      '-i',
      'sine=f=880:r=48000:d=1.6',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-map',
      '2:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '250',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      original,
    ]);
    expect(made.status, made.stderr.toString()).toBe(0);
    const hash = digest(original);
    const [id] = await importAndGetIds(win, [original]);
    if (!id) throw new Error('The full-quality fixture was not imported.');
    const proxy = (id: string) =>
      win.evaluate((id) => (globalThis as unknown as CopiesGlobals).drashti.media.proxyStatus(id), id);
    const readyProxy = async (id: string) => {
      await expect
        .poll(async () => {
          const result = await proxy(id);
          if (!result.ok) throw new Error(result.message);
          if (result.proxy.state === 'failed')
            throw new Error(result.proxy.message ?? 'The lighter copy failed.');
          return result.proxy.state;
        })
        .toBe('ready');
      expect(await proxy(id)).toMatchObject({ ok: true, proxy: { width: 1920, height: 1080 } });
    };
    await readyProxy(id);
    const read = () => win.evaluate((id) => (globalThis as PageGlobals).drashti.media.videoEdit(id), id);
    const before = await read();
    if (!before.ok) throw new Error(before.message);
    const recipe = structuredClone(before.edit.recipe);
    recipe.trim = { startMs: 200, endMs: 1400 };
    recipe.speed = 2;
    recipe.audioTrack = 1;
    recipe.picture.brightness = -0.25;
    recipe.fades = { pictureInMs: 100, pictureOutMs: 100, soundInMs: 100, soundOutMs: 100 };
    expect(
      await win.evaluate(
        ({ id, revision, recipe }) =>
          (globalThis as PageGlobals).drashti.media.setVideoEdit({ mediaId: id, revision, recipe }),
        { id, revision: before.edit.revision, recipe },
      ),
    ).toMatchObject({ ok: true });
    await expect
      .poll(async () => {
        const result = await read();
        if (!result.ok) throw new Error(result.message);
        if (result.edit.state === 'failed')
          throw new Error(result.edit.message ?? 'The edit preparation failed.');
        return result.edit.state;
      })
      .toBe('ready');
    const edit = await read();
    if (!edit.ok) throw new Error(edit.message);
    if (!edit.edit.readyMediaId) throw new Error('The prepared edit has no immutable file.');
    await readyProxy(edit.edit.readyMediaId);
    const output = join(dir, 'Placeholder edited clip.mp4');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, output);
    const accepted = await win.evaluate(
      (request) => (globalThis as unknown as CopiesGlobals).drashti.media.clipExport(request),
      {
        mediaId: id,
        startMs: 200,
        endMs: 1400,
        frame: 'edited' as const,
        shape: 'source' as const,
        container: 'mp4' as const,
        addToLibrary: false,
        revision: edit.edit.revision,
      },
    );
    if (!accepted.ok) throw new Error(accepted.message);
    if (!accepted.job) throw new Error('The edited export was not queued.');
    await expect
      .poll(async () => {
        const jobs = await win.evaluate(() =>
          (globalThis as unknown as CopiesGlobals).drashti.media.clipExports(),
        );
        const job = jobs.find((job) => job.id === accepted.job?.id);
        if (job?.state === 'failed') throw new Error(job.message ?? 'The edited export failed.');
        return job?.state;
      })
      .toBe('done');
    const picture = ffmpeg([
      '-loglevel',
      'info',
      '-ss',
      '0.300',
      '-i',
      output,
      '-an',
      '-frames:v',
      '1',
      '-vf',
      'scale=2:2',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    expect(picture.status, picture.stderr.toString()).toBe(0);
    expect(picture.stderr.toString()).toMatch(/Video: h264[^\r\n]*3840x2160/u);
    const duration = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/u.exec(picture.stderr.toString());
    if (!duration) throw new Error('The exported clip has no readable duration.');
    const ms = (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000;
    expect(Math.abs(ms - 600)).toBeLessThanOrEqual(80);
    expect(picture.stdout).toHaveLength(12);
    const rgb = [picture.stdout[0] ?? 0, picture.stdout[1] ?? 0, picture.stdout[2] ?? 0];
    expect(rgb[0]).toBeGreaterThan(29);
    expect(rgb[0]).toBeLessThan(48);
    expect(rgb[1]).toBeGreaterThan(67);
    expect(rgb[1]).toBeLessThan(86);
    expect(rgb[2]).toBeGreaterThan(104);
    expect(rgb[2]).toBeLessThan(125);
    const sound = ffmpeg([
      '-loglevel',
      'error',
      '-ss',
      '0.150',
      '-i',
      output,
      '-t',
      '0.300',
      '-vn',
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      'f32le',
      'pipe:1',
    ]);
    expect(sound.status, sound.stderr.toString()).toBe(0);
    const count = Math.floor(sound.stdout.length / 4);
    expect(count).toBeGreaterThan(1000);
    const power = (hz: number) => {
      let real = 0,
        imaginary = 0;
      for (let at = 0; at < count; at++) {
        const value = sound.stdout.readFloatLE(at * 4),
          angle = (2 * Math.PI * hz * at) / 8000;
        real += value * Math.cos(angle);
        imaginary += value * Math.sin(angle);
      }
      return (real * real + imaginary * imaginary) / (count * count);
    };
    expect(power(880)).toBeGreaterThan(0.0001);
    expect(power(880)).toBeGreaterThan(power(440) * 20);
    expect(digest(original)).toBe(hash);
    expect(digest(join(userData, 'Media', hash.slice(0, 2), `${hash}.mp4`))).toBe(hash);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
