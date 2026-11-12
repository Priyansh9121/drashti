import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEVC_TYPE } from '../../src/shared/convert';
import {
  closeLibrary,
  dropFiles,
  holdStill,
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
  relaunchApp,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * Every video and sound file (Session 50): an import reads each with the bundled FFmpeg, and what Drashti's
 * player cannot play is converted by itself, one file at a time, after the show, stream and recording are idle.
 * While it waits or converts it says "Converting…" and cannot go live. Media says what was converted.
 * Session 51: HEVC too where this computer cannot play
 * it (the test gives the answer: DRASHTI_TEST_PLAYS_HEVC); a conversion waiting when Drashti quits starts again
 * at the next start; a converted original added again anywhere uses its copy. Generated media only (FFmpeg's
 * test picture and tone, a second each, 64 × 48), deleted at the end.
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

/** A media row's second line in Media: what it is, or how converting it goes, or what it became. */
const noteOf = (win: Page, name: string) =>
  win.getByTestId('media-row').filter({ hasText: name }).getByTestId('media-note');

/** Import one file through the bridge: the library item it landed on, its report lines' codes, and its words. */
const importOne = (win: Page, path: string) =>
  win.evaluate(async (file) => {
    const d = (globalThis as PageGlobals).drashti;
    const result = await d.library.importPaths([file]);
    if (!result.ok) throw new Error(result.message);
    const item = (await d.library.getImportReport(result.run.id))?.items.find((i) => i.sourcePath === file);
    return {
      id: item?.target?.id ?? '',
      codes: item?.issues.map((x) => x.code) ?? [],
      message: item?.message ?? null,
    };
  }, path);

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
    await expect
      .poll(async () => (await conversions(win)).map((job) => job.name).sort(), { timeout: 60_000 })
      .toEqual(Object.keys(converted).sort());
    await expect(win.getByTestId('import-report')).toHaveCount(0);
    await expect(
      win.getByTestId('import-result').getByRole('button', { name: 'Report', exact: true }),
    ).toHaveCount(0);

    // While a file waits for conversion, Media shows why and the show refuses it.
    const imported = await listMedia(win);
    const idOf = (name: string) => imported.find((m) => m.name === name)?.id ?? '';
    for (const name of Object.keys(converted))
      expect(imported.find((m) => m.name === name)).toMatchObject({ unplayable: expect.any(String) });
    expect(imported.find((m) => m.name === 'Placeholder katha.mkv')?.unplayable).toBe(
      'H.264 video with AC-3 sound (Matroska)',
    );
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
    await win.getByRole('tab', { name: 'Media' }).click();
    for (const name of Object.keys(converted)) {
      await expect(noteOf(win, name)).toHaveText('Converting…');
      await expect(
        win.getByTestId('media-row').filter({ hasText: name }).getByTestId('convert-one'),
      ).toHaveCount(0);
    }
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

    // Media shows every converted original and the format of its copy.
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    for (const [name, copy] of Object.entries(converted))
      await expect(noteOf(win, name)).toHaveText(`Converted to ${copy.slice(copy.lastIndexOf('.'))}`);
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ['Pro Mode', 'Simple Mode']) {
  test(`conversion waits for Clear all while a picture is up in ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-show-'));
    const sound = join(dir, 'Placeholder sound.wma');
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      make(['-f', 'lavfi', '-i', 'sine=r=48000:d=1', '-c:a', 'wmav2', sound]);
      const picture = await makeTestImage(win, join(dir, 'Placeholder picture.png'));
      const [mediaId = ''] = await importAndGetIds(win, [picture]);
      const ids = await win.evaluate(async (mediaId) => {
        const d = (globalThis as PageGlobals).drashti;
        const made = await d.playlists.create('Placeholder show', null, false);
        if (!made.ok) throw new Error(made.message);
        const playlistId = made.ids[0] ?? '';
        const added = await d.playlists.addItems(playlistId, null, [{ kind: 'media', mediaId }]);
        if (!added.ok) throw new Error(added.message);
        return { playlistId, itemId: added.ids[0] ?? '' };
      }, mediaId);
      await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder show' }).click();
      if (mode === 'Simple Mode') {
        await win.getByTestId('app-header').getByRole('button', { name: mode, exact: true }).dblclick();
        await expect(win.getByTestId('simple-mode')).toBeVisible();
      }

      const played = await win.evaluate(
        (ids) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', ...ids }),
        ids,
      );
      expect(played).toMatchObject({ ok: true });
      expect((await snapshot(win)).state.layers.background).toMatchObject({ mediaId });
      const imported = await importOne(win, sound);
      expect(imported.codes).toEqual(['converting-media']);
      await expect
        .poll(async () => (await conversions(win))[0])
        .toMatchObject({
          mediaId: imported.id,
          state: 'waiting',
          note: 'Waits while the show is on, then carries on by itself.',
          byItself: true,
        });
      await holdStill(
        async () => (await conversions(win))[0]?.state === 'waiting',
        3200,
        'the live picture keeps conversion waiting beyond the normal startup delay',
      );

      expect(
        await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' })),
      ).toMatchObject({ ok: true });
      await expect
        .poll(async () => (await conversions(win))[0], { timeout: 60_000 })
        .toMatchObject({
          state: 'done',
          convertedName: 'Placeholder sound.m4a',
        });
    } finally {
      await app.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('HEVC is converted by itself at import where this computer cannot play it; where it can, it plays as it is; unless told, as the window says (Session 51)', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-hevc-e2e-'));
  const phone = join(dir, 'Placeholder phone.mov');
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=64x48:r=10',
    '-t',
    '1',
    '-c:v',
    'libx265',
    '-tag:v',
    'hvc1',
    '-x265-params',
    'log-level=error',
    phone,
  ]);
  try {
    // As the operator window would say on a Windows PC without Microsoft's HEVC extension ('0'), on a Mac ('1'), and
    // with no answer given, as this computer's own window says (Chromium's canPlayType, which the import is told:
    // likely playing on a Mac, converted on a Windows runner without a GPU decoder).
    for (const given of ['0', '1', null] as const) {
      const { app, userData } = await launchApp(given === null ? {} : { DRASHTI_TEST_PLAYS_HEVC: given });
      try {
        const win = await operatorPage(app);
        await operatorReady(win);
        const plays =
          given === null
            ? await win.evaluate(
                (type) => document.createElement('video').canPlayType(type) !== '',
                HEVC_TYPE,
              )
            : given === '1';
        // Asked of the window, not given: the log says what it answered.
        if (given === null)
          await expect
            .poll(() => readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8'))
            .toContain(plays ? 'This computer plays HEVC video' : 'This computer cannot play HEVC video');
        const imported = await importOne(win, phone);
        if (plays) {
          // Plays as it is: no line about it, and never converted.
          expect(imported.codes).toEqual([]);
          await letTimePass(win, 4000, 'a conversion at import would have started by now');
          expect(await conversions(win)).toEqual([]);
          expect((await listMedia(win)).find((m) => m.id === imported.id)).toMatchObject({
            unplayable: null,
            convertedTo: null,
          });
        } else {
          // Converted by itself, a moment after the import, into H.264 that plays: the copy is used everywhere.
          expect(imported.codes).toEqual(['converting-media']);
          expect((await listMedia(win)).find((m) => m.id === imported.id)?.unplayable).toBe(
            'HEVC (H.265) video (QuickTime)',
          );
          await expect
            .poll(async () => (await conversions(win)).map((j) => [j.mediaId === imported.id, j.state]), {
              timeout: 60_000,
            })
            .toEqual([[true, 'done']]);
          const media = await listMedia(win);
          expect(media.find((m) => m.id === imported.id)?.convertedTo).toBe('Placeholder phone.mp4');
          expect(media.find((m) => m.name === 'Placeholder phone.mp4')).toMatchObject({
            unplayable: null,
            format: 'H.264 video (MP4), converted by Drashti',
          });
        }
        await app.close();
      } finally {
        await app.close().catch(() => undefined);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the HEVC answer, however late, reaches what uses it: an import started before it waits for it, and Media offers Convert once it comes (question 36)', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-hevc-late-e2e-'));
  const hevc = (picture: string, file: string) => {
    make([
      '-f',
      'lavfi',
      '-i',
      `${picture}=s=64x48:r=10`,
      '-t',
      '1',
      '-c:v',
      'libx265',
      '-tag:v',
      'hvc1',
      '-x265-params',
      'log-level=error',
      file,
    ]);
  };
  const phone = join(dir, 'Placeholder phone.mov');
  const later = join(dir, 'Placeholder phone later.mov');
  hevc('testsrc2', phone);
  hevc('testsrc', later);
  const first = await launchApp({ DRASHTI_TEST_PLAYS_HEVC: '1' });
  let app = first.app;
  try {
    // An HEVC video in the library as it is, taken on a start whose answer was that this computer plays HEVC.
    let win = await operatorPage(app);
    await operatorReady(win);
    expect((await importOne(win, phone)).codes).toEqual([]);
    await app.close();

    // The next start, where this computer cannot play HEVC and its answer comes 12 s late (question 36: Chromium's
    // took about 15 s on CI's Mac late in a run).
    ({ app } = await relaunchApp(first.userData, {
      DRASHTI_TEST_PLAYS_HEVC: '0',
      DRASHTI_TEST_HEVC_ANSWER_MS: '12000',
    }));
    const log = () => readFileSync(join(first.userData, 'logs', 'drashti.log'), 'utf8');
    win = await operatorPage(app);
    await operatorReady(win);
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    const row = win.getByTestId('media-row').filter({ hasText: 'Placeholder phone.mov' });
    // Until the answer comes, Media takes the HEVC video as playing: never said unplayable, nothing offered.
    await expect(noteOf(win, 'Placeholder phone.mov')).toHaveText('Video');
    await expect(row.getByTestId('convert-one')).toHaveCount(0);
    expect(log()).not.toContain('This computer cannot play HEVC video');
    // An import started meanwhile waits for the answer, and converts the HEVC by itself once it comes.
    const imported = await importOne(win, later);
    await expect.poll(log).toContain('This computer cannot play HEVC video');
    expect(imported.codes).toEqual(['converting-media']);
    // Media now says the first one cannot play as it is, and offers to convert it.
    await expect(noteOf(win, 'Placeholder phone.mov')).toContainText('can’t play as it is');
    await expect(row.getByTestId('convert-one')).toBeVisible();
    await expect
      .poll(async () => (await conversions(win)).map((j) => [j.mediaId === imported.id, j.state]), {
        timeout: 60_000,
      })
      .toEqual([[true, 'done']]);
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a conversion waiting when Drashti quits starts again by itself at the next start, never on air (Session 51)', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-resume-e2e-'));
  const bell = join(dir, 'Placeholder bell.aiff');
  make(['-f', 'lavfi', '-i', 'sine=r=48000:d=1', '-t', '1', bell]);
  const first = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  let app = first.app;
  try {
    let win = await operatorPage(app);
    await operatorReady(win);
    // On air: what the import found Drashti cannot play waits to be converted.
    await onAir(app, true);
    const [id = ''] = await importAndGetIds(win, [bell]);
    await expect
      .poll(async () => (await conversions(win)).map((j) => [j.mediaId === id, j.state, j.note !== null]))
      .toEqual([[true, 'waiting', true]]);
    // Drashti quits while it waits.
    await app.close();

    // The next start, on air at once (as a stream that went on air again by itself after a stop would be): it
    // waits again from the start, saying “Converting…”, and past the moment it would start by itself.
    app = (await relaunchApp(first.userData, { DRASHTI_TEST_ON_AIR_HOOK: '1' })).app;
    win = await operatorPage(app);
    await onAir(app, true);
    await operatorReady(win);
    await expect
      .poll(async () => (await conversions(win)).map((j) => [j.mediaId === id, j.state, j.byItself === true]))
      .toEqual([[true, 'waiting', true]]);
    await openLibrary(win);
    await win.getByRole('tab', { name: 'Media' }).click();
    await expect(noteOf(win, 'Placeholder bell.aiff')).toHaveText('Converting…');
    await holdStill(
      async () => (await conversions(win)).every((j) => j.state === 'waiting'),
      15_000,
      'on air at the next start, the conversion kept from the last run waits',
    );
    // Off air: it starts by itself, and its copy is what is used.
    await onAir(app, false);
    await expect
      .poll(async () => (await conversions(win)).map((j) => j.state), { timeout: 60_000 })
      .toEqual(['done']);
    expect((await listMedia(win)).find((m) => m.id === id)?.convertedTo).toBe('Placeholder bell.m4a');
    await expect(noteOf(win, 'Placeholder bell.aiff')).toHaveText('Converted to .m4a');
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a converted original added again anywhere uses its copy: a playlist, an audio playlist, a slide, the same file imported again (Session 51)', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-again-e2e-'));
  const at = (name: string) => join(dir, name);
  make([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=64x48:r=10',
    '-f',
    'lavfi',
    '-i',
    'sine=r=48000:d=1',
    '-t',
    '1',
    '-c:v',
    'mpeg4',
    '-c:a',
    'libmp3lame',
    at('Placeholder katha.avi'),
  ]);
  make(['-f', 'lavfi', '-i', 'sine=r=48000:d=1', '-t', '1', at('Placeholder bell.aiff')]);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [avi = '', aiff = ''] = await importAndGetIds(win, [
      at('Placeholder katha.avi'),
      at('Placeholder bell.aiff'),
    ]);
    await expect
      .poll(async () => (await conversions(win)).map((j) => j.state), { timeout: 120_000 })
      .toEqual(['done', 'done']);
    const media = await listMedia(win);
    const mp4 = media.find((m) => m.name === 'Placeholder katha.mp4')?.id ?? 'no copy';
    const m4a = media.find((m) => m.name === 'Placeholder bell.m4a')?.id ?? 'no copy';

    // The originals, added by hand from Media: to a playlist, to an audio playlist, and to a slide as its
    // background and its sound (the slide editor's save).
    const used = await win.evaluate(
      async ({ avi, aiff }) => {
        const d = (globalThis as PageGlobals).drashti;
        const list = await d.playlists.create('Placeholder sabha', null, false);
        if (!list.ok) throw new Error(list.message);
        const playlistId = list.ids[0] ?? '';
        const added = await d.playlists.addItems(playlistId, null, [{ kind: 'media', mediaId: avi }]);
        if (!added.ok) throw new Error(added.message);
        const item = (await d.playlists.items(playlistId)).find((i) => i.id === added.ids[0]);
        const music = await d.music.create('Placeholder before sabha');
        if (!music.ok || !music.id) throw new Error('The audio playlist was not made.');
        const tracked = await d.music.addTracks(music.id, [aiff], null);
        if (!tracked.ok) throw new Error(tracked.message);
        const track = tracked.view.playlists.find((p) => p.id === music.id)?.tracks[0];
        const presentation = (await d.library.listPresentations())[0]?.id ?? '';
        const opened = await d.library.slidesForEdit(presentation);
        if (!opened.ok) throw new Error(opened.message);
        const slide = opened.doc.groups[0]?.slides[0];
        if (!slide) throw new Error('The placeholder presentation has no slide.');
        slide.cues = [
          ...slide.cues,
          {
            id: 'placeholder-background-cue',
            kind: 'background',
            label: 'Placeholder katha.avi',
            mediaId: avi,
            props: JSON.stringify({ fit: 'fill', loop: true }),
          },
          {
            id: 'placeholder-sound-cue',
            kind: 'audio',
            label: 'Placeholder bell.aiff',
            mediaId: aiff,
            props: JSON.stringify({ loop: false }),
          },
        ];
        const saved = await d.library.saveSlides(presentation, opened.doc, opened.stamp);
        if (!saved.ok) throw new Error(saved.message);
        const reopened = await d.library.slidesForEdit(presentation);
        if (!reopened.ok) throw new Error(reopened.message);
        const cues = reopened.doc.groups[0]?.slides[0]?.cues ?? [];
        return {
          item: item?.kind === 'media' ? item.mediaId : null,
          track: track?.mediaId ?? null,
          // A cue new to the slide gets an id of the library's own: known here by its label.
          cues: cues
            .filter((c) => c.label === 'Placeholder katha.avi' || c.label === 'Placeholder bell.aiff')
            .map((c) => [c.kind, c.mediaId]),
        };
      },
      { avi, aiff },
    );
    expect(used).toEqual({
      item: mp4,
      track: m4a,
      cues: [
        ['background', mp4],
        ['audio', m4a],
      ],
    });

    // The same file imported again: its copy, already in the library, never converted again.
    const again = await importOne(win, at('Placeholder katha.avi'));
    expect(again).toEqual({
      id: mp4,
      codes: [],
      message: 'Already in the media library as “Placeholder katha.mp4”.',
    });
    await letTimePass(win, 4000, 'a conversion at import would have started by now');
    expect((await conversions(win)).map((j) => j.state)).toEqual(['done', 'done']);
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
