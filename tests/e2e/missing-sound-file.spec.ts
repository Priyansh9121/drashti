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
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * A slide's sound cue whose file is missing (Session 53): a presentation imported with its sound not found (on
 * another computer's drive). It goes as a missing background file does (Session 52): nothing goes on the audio layer
 * for it, so what is playing carries on (the sound of the slide before, an audio playlist's music), and LIVE says
 * which file, in Pro Mode and Simple Mode; it says so again after an unexpected restart; and once the file is found
 * (Find missing media…) it says so no more, and the slide plays it the next time it goes up. Until then the missing
 * file went on the audio layer all the same: nothing was heard, what played stopped, and nothing was said. With its
 * background's file missing too, LIVE's two lines fit CI's window (1024 × 645) in both modes, with an audio playlist
 * playing and without: nothing over them, Simple Mode's music strip clear of them, Pro Mode's Next in reach. Since
 * Session 54 the slide's thumbnail, the slide editor and Simple Mode's picture of what is next name a missing sound
 * too, as they name a missing background file, each by the slide's last sound cue, the one that plays (an import
 * can give a slide two); and Simple Mode's Next, naming both files, fits CI's window with LIVE's two lines.
 * Generated tones and placeholder names only.
 */

const FILE = 'Placeholder hymn.wav';
const LINE = `File missing: “${FILE}”. The sound stays as it was.`;
/** A slide's first sound of two, missing too (Session 54). */
const INTRO = 'Placeholder intro.wav';
/** What a slide's thumbnail says of its sound whose file is missing (Session 54), as of a missing background. */
const thumbSays = (file: string) => `“${file}” is missing: the sound stays as it was when this slide goes up`;
/** What the slide editor says of it (Session 54), as of a missing background. */
const editorSays = (file: string) =>
  `The file “${file}” is missing: the sound stays as it was when this slide goes up.`;
/** What Simple Mode's picture of what is next adds for it (Session 54), as for a missing background. */
const nextSays = (file: string) => `, with the sound “${file}”, which is missing: the sound stays as it is`;
const BACKDROP = 'Placeholder backdrop.png';
const BACKDROP_LINE = `File missing: “${BACKDROP}”. The background stays as it was.`;
/** LIVE's two lines, a slide's background file and its sound file missing. */
const LINES = ['live-file-missing', 'live-sound-missing'] as const;

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

/** An audio playlist of this one track, made and played (in Pro Mode: Simple Mode changes no list); its id. */
const playMusic = (win: Page, trackId: string) =>
  win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.music.create('Placeholder before sabha');
    if (!list.ok || !list.id) throw new Error('no audio playlist made');
    await d.music.addTracks(list.id, [id], null);
    const played = await d.music.play(list.id, 0);
    if (!played.ok) throw new Error(played.message);
    return list.id;
  }, trackId);

/** Simple Mode, or Pro Mode again (with the word that leaving Simple Mode asks for), the window drawn so. */
async function switchTo(win: Page, mode: 'simple' | 'pro'): Promise<void> {
  const done = await win.evaluate(
    (m) => (globalThis as PageGlobals).drashti.app.setMode(m, m === 'pro' ? 'pro' : undefined),
    mode,
  );
  expect(done.ok).toBe(true);
  if (mode === 'simple') await expect(win.getByTestId('simple-mode')).toBeVisible();
  else await expect(win.getByTestId('simple-mode')).toHaveCount(0);
}

/**
 * These, by their test ids, as an operator meets them in the window as it is laid out now: each shown whole inside
 * it, with nothing over it (what is drawn at its middle is it, or inside it), and none overlapping `clearOf` (Simple
 * Mode's music strip). Waits for the layout to settle, and says what is wrong when it does not.
 */
async function expectInWindow(
  win: Page,
  ids: readonly string[],
  clearOf: string | null,
  what: string,
): Promise<void> {
  for (const id of ids) await expect(win.getByTestId(id), `${id}, ${what}`).toBeVisible();
  const problems = () =>
    win.evaluate(
      ({ ids, clearOf }) => {
        const out: string[] = [];
        const at = (r: DOMRect) =>
          `${String(Math.round(r.left))},${String(Math.round(r.top))} to ${String(Math.round(r.right))},${String(Math.round(r.bottom))}`;
        const away = clearOf === null ? null : document.querySelector(`[data-testid="${clearOf}"]`);
        if (clearOf !== null && !away) out.push(`there is no ${clearOf}`);
        const a = away?.getBoundingClientRect();
        for (const id of ids) {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) {
            out.push(`there is no ${id}`);
            continue;
          }
          const r = el.getBoundingClientRect();
          if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5)
            out.push(
              `${id} (${at(r)}) is not inside the window (${String(innerWidth)} × ${String(innerHeight)})`,
            );
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || (hit !== el && !el.contains(hit)))
            out.push(
              `${id} is under ${hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? hit?.tagName.toLowerCase() ?? 'nothing'}`,
            );
          if (a && r.left < a.right && a.left < r.right && r.top < a.bottom && a.top < r.bottom)
            out.push(`${clearOf ?? ''} (${at(a)}) overlaps ${id} (${at(r)})`);
        }
        return out;
      },
      { ids, clearOf },
    );
  await expect
    .poll(problems, { message: `${what}, at ${String(CI_WINDOW.width)} × ${String(CI_WINDOW.height)}` })
    .toEqual([]);
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
  await switchTo(win, 'simple');
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  await switchTo(win, 'pro');

  // An audio playlist's music plays on under it too, never stopped for it.
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 2 });
  await expect(win.getByTestId('live-sound-missing')).toHaveCount(0);
  const listId = await playMusic(win, trackId);
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

test('a slide whose background and sound files are both missing: LIVE’s two lines fit CI’s window, 1024 × 645, in Pro and Simple Mode, with an audio playlist playing and without; nothing over them, the music strip clear of them, and Next in reach', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-missing-both-'));
  const track = makeTestTone(join(dir, 'Placeholder music.wav'), { seconds: 300, hz: 330 });
  const show = join(dir, 'Placeholder Missing Both.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-MISSING-BOTH',
      groups: [
        {
          name: 'Verse',
          // Two such slides: with the first up, Simple Mode's Next names both files of the second (Session 54).
          slides: ['Placeholder over two missing files', 'Placeholder over two missing files again'].map(
            (words) => ({
              // Another computer's drive: neither file is found here, nor beside the presentation.
              background: { path: `/Volumes/Placeholder drive/${BACKDROP}`, kind: 'image' as const },
              audio: `/Volumes/Placeholder drive/${FILE}`,
              ...line(words),
            }),
          ),
        },
      ],
    }),
  );
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const [presentationId = ''] = await importAndGetIds(win, [show, track]);
  const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
  const trackId = media.find((m) => m.name.startsWith('Placeholder music'))?.id ?? '';
  expect(trackId).not.toBe('');

  // In CI's window, the slide up: LIVE names both files.
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await expect
    .poll(async () => (await state(win)).layers.slide)
    .toMatchObject({ fileMissing: BACKDROP, soundMissing: FILE });
  await expect(win.getByTestId('live-file-missing')).toHaveText(BACKDROP_LINE);
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);

  // No audio playlist yet: Pro Mode's two lines, and Next under them; Simple Mode's, with no music strip, and its
  // picture of what is next naming both files of the slide after (Session 54).
  await expectInWindow(win, [...LINES, 'show-next'], null, 'Pro Mode, no music');
  await switchTo(win, 'simple');
  await expect(win.getByTestId('simple-music')).toHaveCount(0);
  await expect(win.getByTestId('next-caption')).toHaveText(
    `Placeholder Missing Both, slide 2, over the file “${BACKDROP}”, which is missing: the background stays as it is${nextSays(FILE)}`,
  );
  await expectInWindow(win, [...LINES, 'next-caption'], null, 'Simple Mode, no music');

  // An audio playlist playing: Pro Mode again, then Simple Mode, whose music strip says what plays, clear of them.
  await switchTo(win, 'pro');
  const listId = await playMusic(win, trackId);
  await expect.poll(async () => (await state(win)).layers.audio?.music?.playlistId).toBe(listId);
  await expectInWindow(win, [...LINES, 'show-next'], null, 'Pro Mode, the music playing');
  await switchTo(win, 'simple');
  await expect(win.getByTestId('simple-music')).toContainText('Music: Placeholder before sabha');
  await expect(win.getByTestId('simple-music-pause')).toBeVisible();
  await expectInWindow(win, [...LINES, 'next-caption'], 'simple-music', 'Simple Mode, the music playing');
  // Both still said, and the music never stopped for the slide's sound.
  expect((await state(win)).layers.slide).toMatchObject({ fileMissing: BACKDROP, soundMissing: FILE });
  expect((await state(win)).layers.audio).toMatchObject({ mediaId: trackId, music: { playlistId: listId } });
  await app.close();
});

test('a slide’s missing sound is named in its thumbnail, the slide editor and Simple Mode’s Next, as a missing background file is; of two sounds, by the last, the one that plays (Session 54)', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-missing-sound-named-'));
  const tune = makeTestTone(join(dir, 'Placeholder tune.wav'), { seconds: 30, hz: 440 });
  const show = join(dir, 'Placeholder Named Sounds.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-MISSING-SOUND-NAMED',
      groups: [
        {
          name: 'Verse',
          slides: [
            line('Placeholder before'),
            // Another computer's drive: not found here, nor beside the presentation.
            { audio: `/Volumes/Placeholder drive/${FILE}`, ...line('Placeholder over the missing sound') },
            // Two sounds (an import can give a slide two): the last plays, here the one that is there...
            { audio: [`/Volumes/Placeholder drive/${INTRO}`, tune], ...line('Placeholder over two sounds') },
            // ...and here the one that is missing.
            { audio: [tune, `/Volumes/Placeholder drive/${FILE}`], ...line('Placeholder over two again') },
          ],
        },
      ],
    }),
  );
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  await (await openLibrary(win)).getByTestId('library-tab-presentations').click();
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /^Placeholder Named Sounds/ })
    .click();
  await closeLibrary(win);
  const thumbs = win.getByTestId('slide-thumb');

  // The thumbnails: a missing sound marked and named, as a missing background is; of two sounds, the last.
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.nth(0).getByTestId('thumb-audio')).toHaveCount(0);
  const missing = thumbs.nth(1).getByTestId('thumb-audio');
  await expect(missing).toHaveAttribute('data-missing', 'true');
  await expect(missing).toHaveAttribute('title', thumbSays(FILE));
  const lastThere = thumbs.nth(2).getByTestId('thumb-audio');
  await expect(lastThere).toHaveAttribute('title', 'Plays Placeholder tune.wav');
  await expect(lastThere).not.toHaveAttribute('data-missing');
  const lastMissing = thumbs.nth(3).getByTestId('thumb-audio');
  await expect(lastMissing).toHaveAttribute('data-missing', 'true');
  await expect(lastMissing).toHaveAttribute('title', thumbSays(FILE));
  // In words, as a missing background's badge has it, and in its name (the review): a screen reader says it too.
  const spoken = /, its sound file “Placeholder hymn\.wav” is missing$/u;
  for (const index of [1, 3]) {
    await expect(thumbs.nth(index).getByTestId('thumb-sound-missing')).toHaveText('Missing');
    await expect(thumbs.nth(index)).toHaveAccessibleName(spoken);
  }
  await expect(thumbs.nth(2).getByTestId('thumb-sound-missing')).toHaveCount(0);
  await expect(thumbs.nth(2)).not.toHaveAccessibleName(/is missing/u);

  // The slide editor names the sound it shows, the last, and says when its file is missing (a double-click on a
  // thumbnail opens it at that slide; with nothing changed, Esc closes it).
  const editor = win.getByTestId('slide-editor');
  for (const [index, file, said] of [
    [1, FILE, true],
    [2, 'Placeholder tune.wav', false],
    [3, FILE, true],
  ] as const) {
    await thumbs.nth(index).dblclick();
    await expect(editor.getByTestId('sound-cue')).toHaveText(file);
    if (said) await expect(editor.getByTestId('sound-file-missing')).toHaveText(editorSays(file));
    else await expect(editor.getByTestId('sound-file-missing')).toHaveCount(0);
    await win.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
  }

  // Simple Mode: its picture of what is next names a missing sound before it goes up; of two sounds, the last.
  await switchTo(win, 'simple');
  const caption = win.getByTestId('next-caption');
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 });
  await expect(caption).toHaveText(`Placeholder Named Sounds, slide 2${nextSays(FILE)}`);
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 1 });
  await expect(caption).toHaveText('Placeholder Named Sounds, slide 3');
  await dispatch(win, { type: 'goLive', presentationId, slideIndex: 2 });
  await expect.poll(async () => (await state(win)).layers.audio?.mediaId).toBeTruthy();
  await expect(caption).toHaveText(`Placeholder Named Sounds, slide 4${nextSays(FILE)}`);
  // Next puts it up: the tune plays on, and LIVE says why.
  const tuneUp = (await state(win)).layers.audio;
  await win.getByTestId('simple-buttons').getByRole('button', { name: /^Next/u }).click();
  await expect.poll(async () => (await state(win)).live.slideIndex).toBe(3);
  expect((await state(win)).layers.audio).toMatchObject({
    mediaId: tuneUp?.mediaId,
    startedAt: tuneUp?.startedAt,
  });
  await expect(win.getByTestId('live-sound-missing')).toHaveText(LINE);
  await switchTo(win, 'pro');
  await app.close();
});
