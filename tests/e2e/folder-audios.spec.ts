import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * A folder's sounds also in Audio (Session 44; Priyansh: "all audios if imported via smart playlist should also
 * come up in audio part under a folder which is created with the same name as master folder-audios"): a smart
 * playlist's sounds are in an audio playlist named after it with " - Audios", the same sounds of the library
 * (nothing imported twice), and it keeps in step as the folder changes. Placeholder files only, made here.
 */

const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };

/** The audio playlists, each "name: track, track". */
const audio = (win: Page) =>
  win.evaluate(async () => {
    const view = await (globalThis as PageGlobals).drashti.music.view();
    return view.playlists.map((p) => `${p.name}: ${p.tracks.map((t) => t.name).join(', ')}`);
  });

test('a smart playlist’s sounds are also in Audio, as “<folder> - Audios”: the same sounds, kept in step with the folder', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-folder-audios-'));
  const top = join(work, 'Placeholder Sabha');
  mkdirSync(join(top, 'Week 1'), { recursive: true });
  const { app } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  await makeTestImage(win, join(top, 'Welcome.png'), { color: '#14532d' });
  makeTestTone(join(top, 'Bhajan.wav'), { seconds: 1, hz: 440 });
  makeTestTone(join(top, 'Week 1', 'Katha.wav'), { seconds: 1, hz: 330 });

  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, top);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  await expect
    .poll(() => audio(win), { timeout: 120_000 })
    .toEqual(['Placeholder Sabha - Audios: Bhajan.wav, Katha.wav']);
  await expect(win.getByTestId('music-panel')).toContainText('Placeholder Sabha - Audios');

  // The same sounds as the playlist's: nothing imported twice.
  const same = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const sounds = (await d.library.listMedia()).filter((m) => m.kind === 'audio');
    const smart = (await d.playlists.tree()).find((n) => n.name === 'Placeholder Sabha');
    const items = await d.playlists.items(smart?.id ?? '');
    const tracks = (await d.music.view()).playlists[0]?.tracks ?? [];
    return {
      sounds: sounds.length,
      inPlaylist: items.flatMap((i) => (i.kind === 'media' && i.media === 'audio' ? [i.mediaId] : [])),
      inAudio: tracks.map((t) => t.mediaId),
    };
  });
  expect(same.sounds).toBe(2);
  expect(same.inAudio).toEqual(same.inPlaylist);

  // A sound put in the folder later joins both, at the end of Audio's list.
  makeTestTone(join(top, 'Week 1', 'Later.wav'), { seconds: 1, hz: 550 });
  await expect
    .poll(() => audio(win), { timeout: 60_000 })
    .toEqual(['Placeholder Sabha - Audios: Bhajan.wav, Katha.wav, Later.wav']);
  await app.close();
});
