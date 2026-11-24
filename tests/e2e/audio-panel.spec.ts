import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  dropFiles,
  importAndGetIds,
  launchApp,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { mouseDrag } from './mouse-drag';
import { makeTestImage, makeTestTone } from './test-media';

/*
 * The Audio panel (Session 44; Priyansh: "I can add by drag and drop, in audio and import audio via a small plus
 * sign which says create playlist and import, only 2 options. remove arti section."): a + with exactly Create
 * playlist and Import; sound files dropped from the Finder or Explorer onto an audio playlist, and sounds
 * dragged from the library's sheet, go into it; and the Arti is gone from the window. Generated tones only.
 */

/** Each audio playlist as "name: track, track". */
const audio = (win: Page) =>
  win.evaluate(async () => {
    const view = await (globalThis as PageGlobals).drashti.music.view();
    return view.playlists.map((p) => `${p.name}: ${p.tracks.map((t) => t.name).join(', ')}`);
  });

test('Audio’s + has Create playlist and Import only; sounds dropped or dragged onto an audio playlist go into it; no Arti', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-audio-panel-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 900 });
  await openSection(win, 'audio');
  const group = win.getByTestId('audio-group');
  const panel = win.getByTestId('music-panel');

  // No Arti: neither its panel, its strip nor its dialog; the Audio group holds the music alone.
  for (const gone of ['arti-panel', 'arti-prompt', 'arti-dialog'])
    await expect(win.getByTestId(gone)).toHaveCount(0);
  await expect(group).not.toContainText(/arti/iu);

  // The +: exactly two choices.
  await group.getByTestId('audio-add').click();
  await expect(win.getByRole('menu').getByRole('menuitem')).toHaveText(['Create playlist', 'Import']);
  await expectNoSeriousA11yIssues(win, 'Audio’s + menu');
  // Create playlist: a new one, named in place.
  await win.getByRole('menuitem', { name: 'Create playlist' }).click();
  const name = win.getByRole('textbox', { name: 'Name of the audio playlist' });
  await expect(name).toBeFocused();
  await name.fill('Placeholder before sabha');
  await name.press('Enter');
  const row = (n: string) => panel.getByTestId('music-playlist').filter({ hasText: n });
  await expect(row('Placeholder before sabha')).toHaveAttribute('aria-current', 'true');

  // Sound files dropped from the Finder (Explorer) onto it: imported, and in.
  const bhajan = makeTestTone(join(dir, 'Placeholder bhajan.wav'), { seconds: 1, hz: 440 });
  await dropFiles(win, row('Placeholder before sabha'), [bhajan], { overlay: false });
  await expect.poll(() => audio(win)).toEqual(['Placeholder before sabha: Placeholder bhajan.wav']);

  // Import, from the +: the system's dialog (answered here by the test), into the one shown.
  const dhun = makeTestTone(join(dir, 'Placeholder dhun.wav'), { seconds: 1, hz: 330 });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, dhun);
  await group.getByTestId('audio-add').click();
  await win.getByRole('menuitem', { name: 'Import' }).click();
  await expect
    .poll(() => audio(win))
    .toEqual(['Placeholder before sabha: Placeholder bhajan.wav, Placeholder dhun.wav']);
  // No import report comes up by itself for Audio's imports (the window stays free to go on).
  await expect(win.getByTestId('import-report')).toHaveCount(0);

  // A sound dragged from the library's sheet onto another audio playlist goes into that one.
  await group.getByTestId('audio-add').click();
  await win.getByRole('menuitem', { name: 'Create playlist' }).click();
  await win.getByRole('textbox', { name: 'Name of the audio playlist' }).press('Enter');
  await row('Placeholder before sabha').click();
  const katha = makeTestTone(join(dir, 'Placeholder katha.wav'), { seconds: 1, hz: 550 });
  await importAndGetIds(win, [katha]);
  const sheet = await openLibrary(win);
  await sheet.getByRole('tab', { name: 'Media' }).click();
  await mouseDrag(
    win,
    sheet.getByTestId('media-item').filter({ hasText: 'Placeholder katha' }),
    row('Audio playlist'),
  );
  await expect
    .poll(() => audio(win))
    .toEqual([
      'Placeholder before sabha: Placeholder bhajan.wav, Placeholder dhun.wav',
      'Audio playlist: Placeholder katha.wav',
    ]);
  // Nothing but sounds goes in: a picture dropped there stays in the library, and Drashti says so.
  const picture = await makeTestImage(win, join(dir, 'Placeholder darshan.png'), { color: '#1e3a8a' });
  await dropFiles(win, row('Audio playlist'), [picture], { overlay: false });
  await expect(win.getByTestId('operator-notice')).toContainText('Only sounds');
  expect(await audio(win)).toEqual([
    'Placeholder before sabha: Placeholder bhajan.wav, Placeholder dhun.wav',
    'Audio playlist: Placeholder katha.wav',
  ]);
  await expectNoSeriousA11yIssues(win, 'the Audio panel', '[data-testid="audio-group"]');
  await app.close();
});

/** The audio playlists' names, as the main process has them. */
const audioNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.music.view()).playlists.map((p) => p.name).sort(),
  );

test('Audio folded at the start (alpha.22): + › Create playlist names a new one past the lists already there, as it does open', async () => {
  test.setTimeout(90_000);
  const first = await launchApp();
  const win1 = await operatorPage(first.app);
  await operatorReady(win1);
  // An audio playlist from an earlier day.
  await win1.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.music.create('Audio playlist');
    if (!made.ok) throw new Error('Could not make the audio playlist');
  });
  await first.app.close();
  const { app } = await relaunchApp(first.userData);
  const win = await operatorPage(app);
  await operatorReady(win);
  const toggle = win.getByTestId('group-audio-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Its + on the folded heading, as in the owner's picture.
  await win.getByTestId('audio-add').click();
  await win.getByRole('menuitem', { name: 'Create playlist' }).click();
  await expect.poll(() => audioNames(win)).toEqual(['Audio playlist', 'Audio playlist 2']);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await app.close();
});

test('Audio folded at the start (alpha.22): + › Import of an audio playlist file says at once what it did not take, and nothing comes up later as Audio opens', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-audio-folded-'));
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const toggle = win.getByTestId('group-audio-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // A sound and a web address, which is listed and never fetched (nothing listens there).
  const tone = makeTestTone(join(dir, 'Placeholder bhajan.wav'), { seconds: 2 });
  const web = 'http://127.0.0.1:9/placeholder.wav';
  const list = join(dir, 'Placeholder audio.m3u8');
  writeFileSync(list, `#EXTM3U\n${tone}\n${web}\n`);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, list);
  await win.getByTestId('audio-add').click();
  await win.getByRole('menuitem', { name: 'Import', exact: true }).click();
  const report = win.getByRole('dialog', { name: 'Playlist file: entries not taken' });
  await expect(report).toBeVisible();
  await expect(report.getByTestId('m3u-not-taken')).toContainText(web);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await report.getByRole('button', { name: 'Close playlist file report' }).click();
  await expect(report).toHaveCount(0);
  await expect.poll(() => audio(win)).toEqual(['Placeholder audio: Placeholder bhajan.wav']);
  // Opened afterwards, Audio shows the list, and no report comes up over the show.
  await openSection(win, 'audio');
  await expect(win.getByTestId('music-playlist').filter({ hasText: 'Placeholder audio' })).toBeVisible();
  await expect(report).toHaveCount(0);
  await app.close();
});
