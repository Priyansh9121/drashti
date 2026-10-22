import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeLibrary,
  dropFiles,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Every video and sound file (Session 50): an import reads each with the bundled FFmpeg, and what Drashti's
 * player cannot play is converted by itself, one file at a time, never while the stream is on air or
 * recording. Until it is converted it says "Converting…" and cannot go live; the import report says what was
 * converted; a file that already plays is never converted. Generated media only (FFmpeg's test picture and
 * tone, a second each, 64 × 48), deleted at the end.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function make(args: string[]): void {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
const conversions = (win: Page) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.media.conversions());
const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** The stream on air (or off) as far as Drashti's waiting goes: the test's switch, never a real stream. */
const onAir = (app: ElectronApplication, on: boolean) =>
  app.evaluate((_electron, air) => {
    (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(air);
  }, on);

test('an MKV with AC-3 sound, an AVI, a WMA and an AIFF are converted by themselves at import, never on air; a FLAC and an MP4 that play are not', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-at-import-e2e-'));
  const at = (name: string) => join(dir, name);
  const picture = ['-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10'];
  const tone = ['-f', 'lavfi', '-i', 'sine=r=48000:d=1'];
  const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  make([...picture, ...tone, '-t', '1', ...x264, '-c:a', 'ac3', at('Placeholder katha.mkv')]);
  make([
    ...picture,
    ...tone,
    '-t',
    '1',
    '-c:v',
    'mpeg4',
    '-c:a',
    'libmp3lame',
    at('Placeholder old clip.avi'),
  ]);
  make([...tone, '-t', '1', '-c:a', 'wmav2', at('Placeholder bhajan.wma')]);
  make([...tone, '-t', '1', at('Placeholder bell.aiff')]);
  make([...tone, '-t', '1', at('Placeholder dhun.flac')]);
  make([...picture, ...tone, '-t', '1', ...x264, '-c:a', 'aac', at('Placeholder clip.mp4')]);
  /** Each file Drashti cannot play, and the copy it makes. */
  const converted: Record<string, string> = {
    'Placeholder katha.mkv': 'Placeholder katha.mp4',
    'Placeholder old clip.avi': 'Placeholder old clip.mp4',
    'Placeholder bhajan.wma': 'Placeholder bhajan.m4a',
    'Placeholder bell.aiff': 'Placeholder bell.m4a',
  };
  const plays = ['Placeholder dhun.flac', 'Placeholder clip.mp4'];
  const names = [...Object.keys(converted), ...plays];

  const { app } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // On air: what the import finds it cannot play waits to be converted.
    await onAir(app, true);
    await openLibrary(win);
    await dropFiles(win, win.getByTestId('library-drop'), names.map(at));
    const report = win.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 60_000 });
    const line = (name: string) => report.getByTestId('report-item').filter({ hasText: name }).first();
    for (const name of Object.keys(converted)) {
      await expect(line(name)).toContainText(`Drashti cannot play ${name} as it is: `);
      await expect(line(name)).toContainText('It converts it by itself');
      await expect(line(name).getByTestId('report-converting')).toHaveText('Converting…');
    }
    await expect(line('Placeholder katha.mkv')).toContainText('H.264 video with AC-3 sound (Matroska)');
    for (const name of plays) await expect(line(name)).not.toContainText('cannot play');
    await expect(report.getByTestId('report-converted')).toContainText(
      'Converting 4 files Drashti cannot play as they are, one at a time: each is used everywhere once it is done, and the originals stay as they are.',
    );
    // Nothing for the operator to do: none is offered for Convert.
    await expect(report.getByTestId('report-convert-all')).toHaveCount(0);

    // Until it is converted it cannot go live: in a playlist it says “Converting…”, and the show refuses it.
    const imported = await listMedia(win);
    const idOf = (name: string) => imported.find((m) => m.name === name)?.id ?? '';
    for (const name of Object.keys(converted))
      expect(imported.find((m) => m.name === name)?.unplayable).not.toBeNull();
    for (const name of plays) expect(imported.find((m) => m.name === name)?.unplayable).toBeNull();
    const { playlistId, itemId } = await win.evaluate(async (mediaId) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder converting list', null, false);
      if (!made.ok) throw new Error(made.message);
      const added = await d.playlists.addItems(made.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
      if (!added.ok) throw new Error(added.message);
      return { playlistId: made.ids[0] ?? '', itemId: added.ids[0] ?? '' };
    }, idOf('Placeholder katha.mkv'));
    const play = () =>
      win.evaluate(
        (ids) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', ...ids }),
        { playlistId, itemId },
      );
    expect(await play()).toMatchObject({ ok: false, error: 'not-playable' });
    await report.getByRole('button', { name: 'Close' }).click();
    await win.getByRole('tab', { name: 'Media' }).click();
    const note = (name: string) =>
      win.getByTestId('media-row').filter({ hasText: name }).getByTestId('media-note');
    for (const name of Object.keys(converted)) await expect(note(name)).toHaveText('Converting…');
    await closeLibrary(win);
    await win
      .getByTestId('playlists')
      .getByTestId('playlist-node')
      .filter({ hasText: 'Placeholder converting list' })
      .click();
    const item = win.getByTestId('open-playlist').getByTestId('playlist-item').first();
    await expect(item.getByTestId('badge-converting')).toHaveText('Converting…');
    // Still on air: still waiting, after the moment it would have started.
    await expect
      .poll(async () => (await conversions(win)).map((j) => [j.state, j.note !== null]))
      .toEqual([
        ['waiting', true],
        ['waiting', true],
        ['waiting', true],
        ['waiting', true],
      ]);

    // Off air: one at a time, each by itself.
    await onAir(app, false);
    await expect
      .poll(async () => (await conversions(win)).map((j) => j.state), { timeout: 150_000 })
      .toEqual(['done', 'done', 'done', 'done']);
    const after = await listMedia(win);
    for (const [name, copy] of Object.entries(converted)) {
      expect(after.find((m) => m.name === name)?.convertedTo, name).toBe(copy);
      expect(after.find((m) => m.name === copy)?.unplayable, copy).toBeNull();
    }
    // What already played was never converted.
    const jobs = await conversions(win);
    for (const name of plays) {
      const m = after.find((x) => x.name === name);
      expect(m, name).toMatchObject({ unplayable: null, convertedTo: null });
      expect(
        jobs.some((j) => j.mediaId === m?.id),
        name,
      ).toBe(false);
    }
    // The playlist uses the copy now, and it goes live.
    await expect(item.getByTestId('badge-converting')).toHaveCount(0);
    await expect(item.getByTestId('badge-unplayable')).toHaveCount(0);
    const copyId = after.find((m) => m.name === 'Placeholder katha.mp4')?.id;
    expect(await play()).toMatchObject({ ok: true });
    await expect
      .poll(async () => (await snapshot(win)).state.layers.background)
      .toMatchObject({ mediaId: copyId });

    // The report says what was converted.
    await win.getByTestId('import-result').getByRole('button', { name: 'Report' }).click();
    await expect(report).toBeVisible();
    for (const [name, copy] of Object.entries(converted))
      await expect(line(name).getByTestId('report-converted-file')).toHaveText(`Converted: ${copy}`);
    const summary = report.getByTestId('report-converted');
    await expect(summary).toContainText('Converted 4 files Drashti could not play as they were: ');
    for (const copy of Object.values(converted)) await expect(summary).toContainText(copy);
    await expect(summary).toContainText(
      'The copies are used everywhere, and the originals stay as they are.',
    );
    await report.getByRole('button', { name: 'Close' }).click();
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    await expect(note('Placeholder katha.mkv')).toHaveText('Converted to .mp4');
    await expect(note('Placeholder bhajan.wma')).toHaveText('Converted to .m4a');
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
