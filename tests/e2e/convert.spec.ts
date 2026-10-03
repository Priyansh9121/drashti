import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Converting media Drashti cannot play, with the bundled FFmpeg, on files
 * generated here (and the tiny generated HEIC in tests/fixtures/media).
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function make(args: string[]): void {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

test('convert all: each kind becomes what Drashti plays, the original stays, what used it moves, Undo puts it back', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-e2e-'));
  const at = (name: string) => join(dir, name);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-f',
    'lavfi',
    '-i',
    'sine=r=48000',
    '-t',
    '2',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '2',
    '-c:a',
    'pcm_s16le',
    at('Placeholder clip.mov'),
  ]);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-t',
    '2',
    '-c:v',
    'mpeg4',
    at('Placeholder old clip.avi'),
  ]);
  make([
    '-f',
    'lavfi',
    '-i',
    'color=c=red@0.5:s=320x180:r=25,format=yuva444p10le',
    '-t',
    '2',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4444',
    '-pix_fmt',
    'yuva444p10le',
    at('Placeholder lower third.mov'),
  ]);
  make(['-f', 'lavfi', '-i', 'sine=r=44100', '-t', '2', at('Placeholder sound.aiff')]);
  copyFileSync(
    join(process.cwd(), 'tests', 'fixtures', 'media', 'placeholder.heic'),
    at('Placeholder photo.heic'),
  );
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=25',
    '-t',
    '3',
    '-c:v',
    'libx265',
    '-tag:v',
    'hvc1',
    '-x265-params',
    'log-level=error',
    at('Placeholder hevc.mp4'),
  ]);
  const names = [
    'Placeholder clip.mov',
    'Placeholder old clip.avi',
    'Placeholder lower third.mov',
    'Placeholder sound.aiff',
    'Placeholder photo.heic',
  ];

  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await importAndGetIds(
    win,
    [...names, 'Placeholder hevc.mp4'].map((n) => at(n)),
  );
  const imported = await listMedia(win);
  const idOf = (name: string) => imported.find((m) => m.name === name)?.id ?? '';
  for (const n of names) expect(imported.find((m) => m.name === n)?.unplayable, n).not.toBeNull();

  // The AVI is in a playlist.
  const avi = idOf('Placeholder old clip.avi');
  const { playlistId, itemId } = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.playlists.create('Placeholder list', null, false);
    if (!made.ok) throw new Error(made.message);
    const added = await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
    if (!added.ok) throw new Error(added.message);
    return { playlistId: made.ids[0] ?? '', itemId: added.ids[0] ?? '' };
  }, avi);
  // An HEVC video (which plays only where the computer can decode it) is on the screens while it converts.
  const hevc = idOf('Placeholder hevc.mp4');
  await win.evaluate(
    (mediaId) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
      }),
    hevc,
  );
  const live = (await snapshot(win)).state.layers.background;
  expect(live).toMatchObject({ kind: 'media', mediaId: hevc });
  expect(
    await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.convert([id]), hevc),
  ).toMatchObject({ ok: true });

  // The media list offers Convert all.
  await win.getByRole('tab', { name: 'Media' }).click();
  const bar = win.getByTestId('convert-bar');
  await expect(bar).toContainText('5 files Drashti cannot play');
  await expectNoSeriousA11yIssues(win, 'the media list with files to convert');
  await bar.getByTestId('convert-all').click();
  await expectNoSeriousA11yIssues(win, 'the media list while converting');
  await expect
    .poll(
      async () =>
        (await listMedia(win)).filter((m) => names.includes(m.name) && m.convertedTo !== null).length,
      {
        timeout: 120_000,
      },
    )
    .toBe(5);
  await expectFits(win.getByTestId('media-list'), 'the media list after converting at 1280 x 720');

  const after = await listMedia(win);
  const convertedName = (name: string) => after.find((m) => m.name === name)?.convertedTo;
  expect(convertedName('Placeholder clip.mov')).toBe('Placeholder clip.mp4');
  expect(convertedName('Placeholder old clip.avi')).toBe('Placeholder old clip.mp4');
  expect(convertedName('Placeholder lower third.mov')).toBe('Placeholder lower third.webm');
  expect(convertedName('Placeholder sound.aiff')).toBe('Placeholder sound.m4a');
  expect(convertedName('Placeholder photo.heic')).toBe('Placeholder photo.jpg');
  // The copies play; the originals are still there, as they were.
  for (const copy of [
    'Placeholder clip.mp4',
    'Placeholder old clip.mp4',
    'Placeholder lower third.webm',
    'Placeholder sound.m4a',
    'Placeholder photo.jpg',
  ])
    expect(after.find((m) => m.name === copy)?.unplayable, copy).toBeNull();
  for (const n of names) expect(after.find((m) => m.name === n)?.unplayable, n).not.toBeNull();
  // The original's row says what it became; the copy is a row of its own.
  const aviNote = win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder old clip.avi' })
    .getByTestId('media-note');
  await expect(aviNote).toHaveText('Converted to .mp4');
  await expect(aviNote).toHaveAttribute(
    'title',
    'Converted: everything that used it now uses Placeholder old clip.mp4',
  );

  // What was on the screens carries on as it was, until it is taken down (the HEVC was converted too).
  await expect
    .poll(async () => (await listMedia(win)).find((m) => m.name === 'Placeholder hevc.mp4')?.convertedTo, {
      timeout: 60_000,
    })
    .toBe('Placeholder hevc.mp4');
  expect((await snapshot(win)).state.layers.background).toEqual(live);
  // The playlist uses the copy now: playing the item again shows it.
  const copyId = after.find((m) => m.name === 'Placeholder old clip.mp4')?.id;
  const items = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
    playlistId,
  );
  expect(items.find((i) => i.id === itemId)).toMatchObject({ kind: 'media', mediaId: copyId });
  await win.evaluate(
    ({ playlistId, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId, itemId }),
    { playlistId, itemId },
  );
  await expect
    .poll(async () => (await snapshot(win)).state.layers.background)
    .toMatchObject({ mediaId: copyId });

  // Undo puts the original back where the last conversion moved it.
  const lastDone = await win.evaluate(async () => {
    const jobs = await (globalThis as PageGlobals).drashti.media.conversions();
    return jobs.filter((j) => j.state === 'done').at(-1)?.name ?? '';
  });
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect
    .poll(async () => (await listMedia(win)).find((m) => m.name === lastDone)?.convertedTo)
    .toBeNull();

  // Simple Mode cannot convert, cancel or undo a conversion: the main process refuses.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const conversionId = await win.evaluate(async () => {
    const jobs = await (globalThis as PageGlobals).drashti.media.conversions();
    return jobs.find((j) => j.state === 'done' && j.conversionId !== null)?.conversionId ?? 'none';
  });
  const answers = await win.evaluate(
    async ({ mediaId, conversionId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const all = await Promise.all([
        d.media.convert([mediaId]),
        d.media.cancelConversion(null),
        d.media.undoConversion(conversionId),
      ]);
      return all.map((r) => (r.ok ? 'done' : r.message));
    },
    { mediaId: idOf(lastDone), conversionId },
  );
  for (const a of answers) expect(a).toBe(SIMPLE_MODE_REFUSAL);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await app.close();
});
