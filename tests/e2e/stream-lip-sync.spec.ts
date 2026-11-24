import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { beepAfterFlash, beepTimes, flashTimes, median, readFrames, readSound } from './av-sync';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import { streamPage, streamSoundPage, testFfmpeg } from './stream-helpers';
import { dispatch } from './time-bar-helpers';

/*
 * The stream's own lip sync across its two processes (a22-review-x86 S6). Since alpha.23 the stream's picture is drawn
 * by its page and its sound played by a hidden page of its own, each following the engine's clock, and the encoder
 * puts the two together. A generated video flashes white and beeps at the same instant each second; the stream's own
 * sound only (no microphone) is recorded on this computer, and the recording is read back with the bundled FFmpeg,
 * the picture by frame and the sound by sample: each beep must come with its flash.
 *
 * The limit, from the hall's rule (sound-delay.spec.ts): a video's picture and its sound, in two renderers on the
 * engine's clock, within 0.05 s of where they should be; plus one frame of the recording (1/30 s at every preset),
 * because a flash can only show from the first frame the encoder takes after it is drawn (it takes the newest
 * picture for each 1/30 s of sound). So 0.05 + 1/30 s, about 0.083 s, as the median of the recording's flashes.
 * And the measure must see an offset when there is one: the video's own sound delay of +200 ms (Sound and picture…),
 * set half-way through the same recording, must come out 0.2 s later, within the same limit. Nothing is streamed
 * anywhere; Mac and Windows both.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

/** How far from where it should be the recording's sound may be from its picture (s). */
const LIMIT = 0.05 + 1 / 30;
/** How long each half of the recording runs: about ten flashes. */
const RECORD_MS = 10_000;

/** 120 s of black with a white flash of 0.1 s each second (at half past), and a 1 kHz beep of 0.1 s with it. */
function flashAndBeep(file: string): string {
  const at = 'between(mod(t,1),0.5,0.599)';
  const made = spawnSync(
    ffmpeg ?? '',
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
      ...[
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=320x180:r=30:d=120,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${at}'`,
      ],
      ...['-f', 'lavfi', '-i', `aevalsrc=exprs='if(${at},0.5*sin(2*PI*1000*t),0)':s=48000:d=120`],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30'],
      ...['-c:a', 'aac', '-b:a', '128k', file],
    ],
    { timeout: 120_000, windowsHide: true },
  );
  if (made.status !== 0) throw new Error(made.stderr.toString());
  return file;
}

/** Where a page's media element is (s), or null while it is not playing. */
const timeOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLMediaElement>(s);
    return el && !el.paused ? el.currentTime : null;
  }, selector);

/** How far the stream's sound page trails its picture page (s): the median of five readings, or null. */
async function pagesTrail(
  picture: Page,
  pictureSel: string,
  sound: Page,
  soundSel: string,
): Promise<number | null> {
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    const [p, s] = await Promise.all([timeOf(picture, pictureSel), timeOf(sound, soundSel)]);
    if (p !== null && s !== null) seen.push(p - s);
    await letTimePass(picture, 100, 'the next reading');
  }
  return seen.length >= 3 ? median(seen) : null;
}

test('the stream’s own picture and sound stay together in what it records, across its picture and sound pages', async () => {
  test.setTimeout(240_000);
  expect(ffmpeg, 'CI supplies the bundled encoder').not.toBeNull();
  const dir = test.info().outputPath('lip-sync');
  const folder = join(dir, 'recordings');
  await mkdir(folder, { recursive: true });
  const file = flashAndBeep(join(dir, 'Placeholder flash and beep.mp4'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [id = ''] = await importAndGetIds(win, [file]);
    expect(id).not.toBe('');
    await app.evaluate(({ dialog }, into) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
    }, folder);
    // The stream's own sound only (Drashti's, no microphone and no camera), recorded at the weak preset (720p30).
    expect(
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        const { profiles, activeId } = await d.stream.profiles();
        const p = profiles.find((x) => x.id === activeId);
        if (!p) return 'no profile';
        const saved = await d.stream.saveProfile(p.id, {
          name: p.name,
          url: p.url,
          preset: 'weak',
          camera: null,
          sound: null,
          soundDelayMs: 0,
          mixOwnSound: true,
        });
        if (!saved.ok) return saved.message;
        const picked = await d.stream.pickFolder();
        if (!picked.ok) return picked.message;
        await d.stream.watchPreview(true);
        return 'ok';
      }),
    ).toBe('ok');
    const picturePage = await streamPage(app);
    const soundPage = await streamSoundPage(app);
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: id, media: 'video', fit: 'fill', loop: true },
        })
      ).ok,
    ).toBe(true);
    const picture = `[data-layer="background"] video[data-media-id="${id}"]`;
    const streamed = `audio[data-key^="background:${id}@"]`;
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());

    /** The stream's two pages in step by the hall's rule (within 0.05 s), the sound this far behind the picture. */
    const inStep = (trail: number, why: string) =>
      expect
        .poll(
          async () => Math.abs(((await pagesTrail(picturePage, picture, soundPage, streamed)) ?? 9) - trail),
          { timeout: 20_000, message: `${why}: the stream’s two pages in step first` },
        )
        .toBeLessThan(0.05);

    // One recording (its sound output held awake all through), the sound delay changed half-way.
    await inStep(0, 'no sound delay');
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.startRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.bytes).toBeGreaterThan(0);
    const { file: name, since } = (await status()).recording;
    await letTimePass(win, RECORD_MS, 'about ten flashes and beeps with no sound delay');
    // The control: the video's own sound delay of +200 ms (Sound and picture…) must come out 0.2 s later, so a fault
    // that put the stream's sound off its picture would be seen.
    const changedAt = Date.now();
    const settings = await win.evaluate((v) => (globalThis as PageGlobals).drashti.media.playback(v), id);
    if (!settings) throw new Error('The generated video has no Sound and picture… settings');
    expect(
      (
        await win.evaluate(({ v, s }) => (globalThis as PageGlobals).drashti.media.setPlayback(v, s), {
          v: id,
          s: { ...settings, soundDelayMs: 200 },
        })
      ).ok,
    ).toBe(true);
    await inStep(0.2, 'sound delay +200 ms');
    const settledAt = Date.now();
    await letTimePass(win, RECORD_MS, 'about ten flashes and beeps with +200 ms of sound delay');
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording())).ok).toBe(
      true,
    );
    await expect.poll(async () => (await status()).recording.state).toBe('off');
    const recording = join(folder, name ?? '');
    expect(existsSync(recording), 'the recording is kept').toBe(true);

    const flashes = flashTimes(readFrames(ffmpeg ?? '', recording));
    const sound = readSound(ffmpeg ?? '', recording);
    const beeps = beepTimes(sound);
    // The file's clock runs with its sound from the encoder's start, a moment after the recording's (since): these
    // margins leave out the flashes near the change whichever way that moment falls.
    const fileTime = (at: number) => sound.start + (at - (since ?? 0)) / 1000;
    const parts = [
      { why: 'no sound delay', trail: 0, flashes: flashes.filter((t) => t < fileTime(changedAt) - 1.5) },
      {
        why: 'sound delay +200 ms',
        trail: 0.2,
        flashes: flashes.filter((t) => t > fileTime(settledAt) + 0.5),
      },
    ];
    await test.info().attach('lip-sync.json', {
      body: JSON.stringify({ since, changedAt, settledAt, flashes, beeps }, null, 2),
      contentType: 'application/json',
    });
    for (const part of parts) {
      const offsets = beepAfterFlash(part.flashes, beeps);
      const ms = offsets.map((o) => (o * 1000).toFixed(1)).join(' ');
      console.log(`Lip sync, ${part.why}: each beep after its flash (ms) ${ms}`);
      expect(
        offsets.length,
        `${part.why}: flashes with their beeps (${String(part.flashes.length)} flashes, ${String(beeps.length)} beeps in all)`,
      ).toBeGreaterThanOrEqual(6);
      expect(
        Math.abs((median(offsets) ?? 9) - part.trail),
        `${part.why}: the recording’s sound ${String(part.trail)} s after its picture (each beep after its flash, ms: ${ms})`,
      ).toBeLessThanOrEqual(LIMIT);
    }
  } finally {
    await app.close();
  }
});
