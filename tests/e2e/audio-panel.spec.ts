import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { dropFiles, importAndGetIds, launchApp, openLibrary, operatorPage, operatorReady } from './helpers';
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
