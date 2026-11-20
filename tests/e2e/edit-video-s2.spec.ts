import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoEditResult } from '../../src/shared/video-edit';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

test('a saved edit prepares privately at idle, then a new showing pins its immutable file', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-edit-video-s2-'));
    const source = join(dir, 'Placeholder prepared.mp4');
    const made = spawnSync(testFfmpeg() ?? '', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000:d=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads:v',
      '1',
      '-c:a',
      'aac',
      '-shortest',
      source,
    ]);
    expect(made.status).toBe(0);
    const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    const before = hash(source);
    const [id = ''] = await importAndGetIds(win, [source]);
    const managed = join(userData, 'Media', before.slice(0, 2), `${before}.mp4`);
    const state = () =>
      win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
    const dispatch = (
      background:
        | { kind: 'color'; color: string }
        | { kind: 'media'; mediaId: string; media: 'video'; fit: 'fit'; loop: boolean },
    ) =>
      win.evaluate(
        (background) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setBackground', background }),
        background,
      );
    const read = () =>
      win.evaluate(
        (id): Promise<VideoEditResult> => (globalThis as PageGlobals).drashti.media.videoEdit(id),
        id,
      );
    expect((await dispatch({ kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true })).ok).toBe(
      true,
    );
    const originalShowing = (await state()).layers.background;
    const saved = await win.evaluate(async (id) => {
      const media = (globalThis as PageGlobals).drashti.media;
      const current = await media.videoEdit(id);
      if (!current.ok) throw new Error(current.message);
      return media.setVideoEdit({
        mediaId: id,
        revision: current.edit.revision,
        recipe: {
          ...current.edit.recipe,
          speed: 2,
          trim: { startMs: 1000, endMs: 3000 },
          picture: { ...current.edit.recipe.picture, frame: '1:1', flipX: true, brightness: 0.1 },
        },
      });
    }, id);
    expect(saved).toMatchObject({ ok: true, edit: { state: 'preparing', readyMediaId: null } });
    expect((await state()).layers.background).toEqual(originalShowing);
    await dispatch({ kind: 'color', color: '#202020' });
    expect(
      await dispatch({ kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true }),
    ).toMatchObject({ ok: false, error: 'preparing' });
    expect(
      (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' })))
        .ok,
    ).toBe(true);
    await expect
      .poll(
        async () => {
          const result = await read();
          return result.ok ? result.edit.state : result.message;
        },
        { timeout: 60_000 },
      )
      .toBe('ready');
    const ready = await read();
    if (!ready.ok) throw new Error(ready.message);
    expect(ready.edit.readyMediaId).not.toBe(id);
    expect(ready.edit.readyMediaId).not.toBeNull();
    expect((await dispatch({ kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true })).ok).toBe(
      true,
    );
    expect((await state()).layers.background).toMatchObject({
      mediaId: ready.edit.readyMediaId,
      durationMs: 1000,
    });
    const pinned = (await state()).layers.background;
    await win.evaluate(async (id) => {
      const media = (globalThis as PageGlobals).drashti.media;
      const current = await media.videoEdit(id);
      if (!current.ok) throw new Error(current.message);
      return media.setVideoEdit({
        mediaId: id,
        revision: current.edit.revision,
        recipe: { ...current.edit.recipe, speed: 0.5 },
      });
    }, id);
    expect((await state()).layers.background).toEqual(pinned);
    expect(hash(source)).toBe(before);
    expect(hash(managed)).toBe(before);
  } finally {
    await app.close();
  }
});
