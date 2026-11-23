import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { streamPage, streamSoundPage, testFfmpeg } from './stream-helpers';
import { audioPage, dispatch } from './time-bar-helpers';

/*
 * Sound and picture…'s delays (alpha.20: the owner's "Yes, all A" to Q60-39 P6 (a) A): a video's sound set +200 ms in
 * its window trails its picture on the audience screen by 0.2 s in the hall (the audio player) and on the stream (its
 * page's own sound); its captions set +500 ms show each line half a second later on the audience screen. The
 * pictures never move. A generated video with a tone and placeholder captions only; nothing is streamed anywhere.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const SRT =
  '1\n00:00:00,000 --> 00:00:04,000\nFirst placeholder\n\n2\n00:00:04,000 --> 00:00:09,000\nSecond placeholder\n';

/** 60 s of a small moving picture with a tone, as MP4. */
function clip(file: string): string {
  const r = spawnSync(
    ffmpeg ?? '',
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
      ...[
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=320x180:r=25:d=60',
        '-f',
        'lavfi',
        '-i',
        'sine=f=440:r=48000:d=60',
      ],
      ...[
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        file,
      ],
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return file;
}

const timeOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLMediaElement>(s);
    return el && !el.paused ? el.currentTime : null;
  }, selector);

/** How far the sound trails the picture (s), the median of a few readings taken together. */
async function trailing(
  picture: Page,
  pictureSel: string,
  sound: Page,
  soundSel: string,
): Promise<number | null> {
  const seen: number[] = [];
  for (let i = 0; i < 9; i++) {
    const [p, s] = await Promise.all([timeOf(picture, pictureSel), timeOf(sound, soundSel)]);
    if (p !== null && s !== null) seen.push(p - s);
    await letTimePass(picture, 100, 'the next reading');
  }
  seen.sort((a, b) => a - b);
  return seen.length >= 5 ? (seen[Math.floor(seen.length / 2)] ?? null) : null;
}

test('a video’s sound +200 ms trails its picture by 0.2 s in the hall and on the stream; its captions +500 ms come half a second later', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-sound-delay-'));
    const file = clip(join(dir, 'Placeholder delayed clip.mp4'));
    const srt = join(dir, 'Placeholder delayed clip.en.srt');
    writeFileSync(srt, SRT);
    const [id = ''] = await importAndGetIds(win, [file]);
    rmSync(srt);
    expect(id).not.toBe('');
    await setUpScreen(win, 'Main Hall', 0);
    await expect.poll(() => outputPages(app).length).toBe(1);
    const [hall] = outputPages(app) as [Page];
    await outputReady(hall);
    // Drashti's own sound in the stream's page (its preview kept running: nothing is sent anywhere).
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const { profiles, activeId } = await d.stream.profiles();
      const p = profiles.find((x) => x.id === activeId);
      if (!p) throw new Error('no profile');
      const saved = await d.stream.saveProfile(p.id, {
        name: p.name,
        url: p.url,
        preset: p.preset,
        camera: null,
        sound: null,
        soundDelayMs: 0,
        mixOwnSound: true,
      });
      if (!saved.ok) throw new Error(saved.message);
      await d.stream.watchPreview(true);
    });
    const program = await streamSoundPage(app);
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
        })
      ).ok,
    ).toBe(true);
    const audio = await audioPage(app);
    const picture = `[data-layer="background"] video[data-media-id="${id}"]`;
    const heard = `audio[data-media-id="${id}"]`;
    const streamed = `audio[data-key^="background:${id}@"]`;
    await expect.poll(() => trailing(hall, picture, audio, heard), { timeout: 20_000 }).not.toBeNull();

    // +200 ms, in its window from its right-click menu in Media.
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    await win
      .getByTestId('media-item')
      .filter({ hasText: 'Placeholder delayed clip' })
      .click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Sound and picture…' }).click();
    const dialog = win.getByTestId('sound-picture');
    await dialog.getByLabel('Sound delay').fill('200');
    await expect(dialog.getByTestId('sound-picture-soundDelayMs-words')).toHaveText(
      '+0.20 s: the sound comes 0.20 s later than the picture',
    );
    // And the stream's own picture against its own sound (a22-review-x86 S6): two renderers since alpha.23, each on
    // the engine's time, the stream's sound in a page of its own.
    const streamPicture = await streamPage(app);
    for (const [what, picturePage, page, selector] of [
      ['the hall', hall, audio, heard],
      ['the stream', hall, program, streamed],
      ['the stream’s own picture', streamPicture, program, streamed],
    ] as const)
      await expect
        .poll(async () => Math.abs(((await trailing(picturePage, picture, page, selector)) ?? 9) - 0.2), {
          timeout: 20_000,
          message: `${what}: the sound 0.2 s behind the picture`,
        })
        .toBeLessThan(0.05);

    // Captions +500 ms: paused at 4.2 s, the line for 3.7 s (the first), and at 4.6 s the second.
    expect(
      (await win.evaluate((v) => (globalThis as PageGlobals).drashti.videoCaptions.view(v), id)).tracks,
    ).toHaveLength(1);
    const track = (await win.evaluate((v) => (globalThis as PageGlobals).drashti.videoCaptions.view(v), id))
      .tracks[0];
    expect(
      (
        await win.evaluate(({ v, t }) => (globalThis as PageGlobals).drashti.videoCaptions.select(v, t), {
          v: id,
          t: track?.id ?? '',
        })
      ).ok,
    ).toBe(true);
    await dialog.getByLabel('Caption delay').fill('500');
    const caption = hall.locator('[data-testid="captions"][data-source="video"]');
    await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } });
    await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 4200 });
    await expect(caption).toHaveText('First placeholder', { timeout: 15_000 });
    await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 4600 });
    await expect(caption).toHaveText('Second placeholder', { timeout: 15_000 });
  } finally {
    await app.close();
  }
});
