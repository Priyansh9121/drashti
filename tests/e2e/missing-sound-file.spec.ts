import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  closeLibrary,
  importAndGetIds,
  killApp,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
  relaunchApp,
  savedLive,
} from './helpers';
import { makeTestTone } from './test-media';

/*
 * A slide's sound cue whose file is missing (Session 53): a presentation imported with its sound not found (on
 * another computer's drive). It goes as a missing background file does (Session 52): nothing goes on the audio layer
 * for it, so what is playing carries on (the sound of the slide before, an audio playlist's music), and LIVE says
 * which file, in Pro Mode and Simple Mode; it says so again after an unexpected restart; and once the file is found
 * (Find missing media…) it says so no more, and the slide plays it the next time it goes up. Until then the missing
 * file went on the audio layer all the same: nothing was heard, what played stopped, and nothing was said.
 * Generated tones and placeholder names only.
 */

const FILE = 'Placeholder hymn.wav';
const LINE = `File missing: “${FILE}”. The sound stays as it was.`;

const line = (text: string) => ({ text: [{ rtf: cocoaRtf([[text, 80, [255, 255, 255]]]) }] });

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

function dispatch(win: Page, command: EngineCommand) {
  return win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c), command);
}

async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/** The audio player plays this file from this start (the same playback, carrying on), and nothing else. */
async function plays(audio: Page, mediaId: string, startedAt: number | undefined): Promise<void> {
  const sound = audio.locator('audio');
  await expect(sound).toHaveCount(1);
  await expect(sound).toHaveAttribute('data-key', `audio:${mediaId}@${String(startedAt)}`);
  await expect.poll(() => sound.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true);
}

test('a missing file as a slide’s sound: nothing goes up for it, what is playing carries on (a sound, an audio playlist’s music), and LIVE says why in Pro and Simple Mode; again after a restart, and once found it plays', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-missing-sound-'));
  // The audio cue in these files loops: the tune never ends while the test runs; nor does the music's long track.
  const tune = makeTestTone(join(dir, 'Placeholder tune.wav'), { seconds: 30, hz: 440 });
  const track = makeTestTone(join(dir, 'Placeholder music.wav'), { seconds: 300, hz: 330 });
  const show = join(dir, 'Placeholder Missing Sound.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-MISSING-SOUND',
      groups: [
        {
          name: 'Verse',
          slides: [
            { audio: tune, ...line('Placeholder with the tune') },
            // Another computer's drive: not found here, nor beside the presentation.
            { audio: `/Volumes/Placeholder drive/${FILE}`, ...line('Placeholder over the missing sound') },
            line('Placeholder after'),
          ],
        },
      ],
    }),
  );
  const first = await launchApp();
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const [presentationId = ''] = await importAndGetIds(win, [show, track]);
  const cues = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.library.getPresentation(id))?.groups[0]?.slides.map(
        (s) => s.cues[0],
      ),
    presentationId,
  );
  const [tuneCue, hymnCue] = cues ?? [];
  expect(tuneCue).toMatchObject({ kind: 'audio', name: 'Placeholder tune.wav', missing: false });
  expect(hymnCue).toMatchObject({ kind: 'audio', name: FILE, missing: true });
  const tuneId = tuneCue?.kind === 'audio' ? tuneCue.mediaId : '';
  const hymnId = hymnCue?.kind === 'audio' ? hymnCue.mediaId : '';
  const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
  const trackId = media.find((m) => m.name.startsWith('Placeholder music'))?.id ?? '';
  expect(trackId).not.toBe('');
  const audio = await audioPage(first.app);

  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Missing Sound/ })
    .click();
  await closeLibrary(win);
  const thumbs = win.getByTestId('slide-thumb');

  // Up with its tune: it plays.
  await thumbs.nth(0).click();
  await expect.poll(async () => (await state(win)).layers.audio?.mediaId).toBe(tuneId);
  const tuneUp = (await state(win)).layers.audio;
  await plays(audio, tuneId, tuneUp?.startedAt);

  // The slide whose sound is missing: nothing goes on the audio layer for it, the tune plays on, and LIVE says why.
  await thumbs.nth(1).click();
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  expect((await state(win)).layers.audio).toMatchObject({ mediaId: tuneId, startedAt: tuneUp?.startedAt });
  expect((await state(win)).layers.slide).toMatchObject({ slideIndex: 1, soundMissing: FILE });
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  await plays(audio, tuneId, tuneUp?.startedAt);
  await settled(win);
  await expectNoSeriousA11yIssues(win, 'LIVE saying a slide’s sound file is missing');

  // Next goes on to a slide naming none: LIVE says nothing more. Back brings it back, saying so again.
  await dispatch(win, { type: 'next' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(2);
  await expect(win.getByTestId('live-sound-missing')).toHaveCount(0);
  await dispatch(win, { type: 'back' });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  await plays(audio, tuneId, tuneUp?.startedAt);

  // Simple Mode's LIVE says why, as Pro Mode's does.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  const pro = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  expect(pro.ok).toBe(true);
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // An audio playlist's music plays on under it too, never stopped for it.
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 2 });
  await expect(win.getByTestId('live-sound-missing')).toHaveCount(0);
  const listId = await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.music.create('Placeholder before sabha');
    if (!list.ok || !list.id) throw new Error('no audio playlist made');
    await d.music.addTracks(list.id, [id], null);
    const played = await d.music.play(list.id, 0);
    if (!played.ok) throw new Error(played.message);
    return list.id;
  }, trackId);
  await expect.poll(async () => (await state(win)).layers.audio?.music?.playlistId).toBe(listId);
  const musicUp = (await state(win)).layers.audio;
  expect(musicUp).toMatchObject({ mediaId: trackId });
  await plays(audio, trackId, musicUp?.startedAt);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 1 });
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(1);
  expect((await state(win)).layers.audio).toMatchObject({
    mediaId: trackId,
    startedAt: musicUp?.startedAt,
    music: { playlistId: listId },
  });
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  await plays(audio, trackId, musicUp?.startedAt);

  // Stopped dead with it up: the next start puts it back, the music playing on, and LIVE says why again.
  await savedLive(
    first.userData,
    (saved) => saved.slide?.slideIndex === 1 && saved.audio?.mediaId === trackId,
  );
  await killApp(first.app);
  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await operatorReady(win2);
  await expect.poll(async () => (await state(win2)).layers.slide?.slideIndex).toBe(1);
  expect((await state(win2)).layers.slide).toMatchObject({ soundMissing: FILE });
  expect((await state(win2)).layers.audio).toMatchObject({ mediaId: trackId, startedAt: musicUp?.startedAt });
  await expect(win2.getByTestId('live-sound-missing')).toHaveText(LINE);

  // Found again (Find missing media…, the folder answered here by the test): LIVE says so no more at once, the music
  // playing on; the slide shown again plays it.
  const found = mkdtempSync(join(tmpdir(), 'drashti-found-'));
  makeTestTone(join(found, FILE), { seconds: 30, hz: 550 });
  await second.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, found);
  const relinked = await win2.evaluate(() => (globalThis as PageGlobals).drashti.library.relinkMedia());
  expect(relinked.ok).toBe(true);
  await expect(win2.getByTestId('live-sound-missing')).toHaveCount(0);
  expect((await state(win2)).layers.slide).not.toHaveProperty('soundMissing');
  expect((await state(win2)).layers.audio).toMatchObject({ mediaId: trackId });
  await dispatch(win2, { type: 'goLive', presentationId, slideIndex: 1 });
  await expect.poll(async () => (await state(win2)).layers.audio?.mediaId).toBe(hymnId);
  await expect(win2.getByTestId('live-sound-missing')).toHaveCount(0);
  const hymnUp = (await state(win2)).layers.audio;
  await plays(await audioPage(second.app), hymnId, hymnUp?.startedAt);
  await second.app.close();
});
