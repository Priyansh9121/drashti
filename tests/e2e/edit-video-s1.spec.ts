import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoEditResult } from '../../src/shared/video-edit';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/** Only generated swatches and a generated tone; the source hash is checked after every editor action. */
function fixture(file: string): string {
  const r = spawnSync(testFfmpeg() ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=25:d=12',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:r=48000:d=12',
    '-vf',
    "drawbox=color=blue:t=fill:enable='gte(t,2)'",
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads:v',
    '1',
    '-c:a',
    'aac',
    '-shortest',
    file,
  ]);
  expect(r.status, 'the bundled FFmpeg made the generated source').toBe(0);
  return file;
}

const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const edit = (win: Page, id: string): Promise<VideoEditResult> =>
  win.evaluate((id) => {
    const media = (globalThis as PageGlobals).drashti.media as PageGlobals['drashti']['media'] & {
      videoEdit(id: string): Promise<VideoEditResult>;
    };
    return media.videoEdit(id);
  }, id);

async function open(win: Page, name: string) {
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await win.getByTestId('media-item').filter({ hasText: name }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Edit Video…', exact: true }).click();
  const dialog = win.getByTestId('edit-video');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.getByTestId('edit-video-preview').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  return dialog;
}

test('Edit Video…: one private draft window, source-time jump, chosen library frame, Cancel and Reset at 1024 × 645', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-edit-video-s1-'));
    const source = fixture(join(dir, 'Placeholder editor.mp4'));
    const sha = hash(source);
    const [id = ''] = await importAndGetIds(win, [source]);
    expect(id).not.toBe('');
    const managed = join(userData, 'Media', sha.slice(0, 2), `${sha}.mp4`);
    expect(hash(managed)).toBe(sha);
    let dialog = await open(win, 'Placeholder editor');
    await expectFits(dialog, 'Edit Video at the CI operator size');
    await expectNoSeriousA11yIssues(win, 'Edit Video');
    await dialog.getByLabel('Go to time').fill('0:03');
    await dialog.getByRole('button', { name: 'Jump', exact: true }).click();
    await expect
      .poll(() => dialog.getByTestId('edit-video-preview').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(3, 1);
    await dialog.getByRole('button', { name: 'Use this frame as library thumbnail' }).click();
    expect(await edit(win, id)).toMatchObject({
      ok: true,
      edit: { revision: 0, recipe: { thumbnailMs: null } },
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await win.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await edit(win, id)).toMatchObject({ ok: true, edit: { revision: 0 } });
    dialog = await open(win, 'Placeholder editor');
    await dialog.getByLabel('Go to time').fill('0:03');
    await dialog.getByRole('button', { name: 'Jump', exact: true }).click();
    await expect
      .poll(() => dialog.getByTestId('edit-video-preview').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(3, 1);
    await dialog.getByRole('button', { name: 'Use this frame as library thumbnail' }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByTestId('edit-video-status')).toHaveText('Ready for next showing');
    expect(await edit(win, id)).toMatchObject({
      ok: true,
      edit: { revision: 1, recipe: { thumbnailMs: 3000 } },
    });
    const pixel = await win.evaluate(async (id) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `drashti-media://still/${id}?chosen=1`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas.');
      ctx.drawImage(img, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }, id);
    expect(pixel[2]).toBeGreaterThan(200);
    expect(pixel[0]).toBeLessThan(50);
    await dialog.getByRole('button', { name: 'Reset edits', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect(await edit(win, id)).toMatchObject({
      ok: true,
      edit: { revision: 2, recipe: { thumbnailMs: null } },
    });
    expect(hash(source)).toBe(sha);
    expect(hash(managed)).toBe(sha);
  } finally {
    await app.close();
  }
});

test('Save pins the current showing and a later attempt waits for its edited copy, with stale saves refused', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-edit-video-live-'));
    const [id = ''] = await importAndGetIds(win, [fixture(join(dir, 'Placeholder private.mp4'))]);
    const show = () =>
      win.evaluate(
        (id) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({
            type: 'setBackground',
            background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
          }),
        id,
      );
    expect((await show()).ok).toBe(true);
    const before = await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
    );
    const dialog = await open(win, 'Placeholder private');
    await dialog.getByRole('button', { name: 'Playback', exact: true }).click();
    await dialog.getByLabel('Speed').selectOption('2');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByTestId('edit-video-status')).toHaveText('Preparing');
    expect(await edit(win, id)).toMatchObject({
      ok: true,
      edit: { revision: 1, state: 'preparing', recipe: { speed: 2 } },
    });
    expect(
      await win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
      ),
    ).toEqual(before);
    const stale = await win.evaluate(async (id) => {
      const d = (globalThis as PageGlobals).drashti;
      const media = d.media as PageGlobals['drashti']['media'] & {
        videoEdit(id: string): Promise<VideoEditResult>;
        setVideoEdit(request: unknown): Promise<VideoEditResult>;
      };
      const r = await media.videoEdit(id);
      if (!r.ok) throw new Error(r.message);
      return media.setVideoEdit({ mediaId: id, revision: 0, recipe: r.edit.recipe });
    }, id);
    expect(stale).toMatchObject({ ok: false, message: expect.stringContaining('changed') });
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearLayer', layer: 'background' }),
    );
    expect(await show()).toMatchObject({
      ok: false,
      error: 'preparing',
      message: expect.stringContaining('preparing'),
    });
  } finally {
    await app.close();
  }
});
