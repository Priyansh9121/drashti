import { beginCueDiagnostics, retainCueDiagnostics } from './video-cue-diagnostics';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';
import { freePort, readFlv, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';

function powershell(command: string): string {
  const env = { ...process.env };
  delete env['PSModulePath'];
  const exe = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const result = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) throw new Error('The two-core processor-affinity check failed');
  return result.stdout.trim();
}

async function frames(page: Page, ms: number) {
  const measured = await page.evaluate(async (ms) => {
    let before = performance.now();
    const until = before + ms;
    const gaps: number[] = [];
    const decoders = new Map<
      HTMLVideoElement,
      { start: number; droppedStart: number; total: number; dropped: number }
    >();
    const observe = (initial: boolean) => {
      (globalThis as { s5Diagnostics?: { sample: () => void } }).s5Diagnostics?.sample();
      for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-media-id]')) {
        const q = video.getVideoPlaybackQuality();
        let seen = decoders.get(video);
        if (!seen) {
          seen = {
            start: initial ? q.totalVideoFrames : 0,
            droppedStart: initial ? q.droppedVideoFrames : 0,
            total: 0,
            dropped: 0,
          };
          decoders.set(video, seen);
        }
        // Keep the maximum if an outgoing element's cleanup resets its decoder counters.
        seen.total = Math.max(seen.total, q.totalVideoFrames);
        seen.dropped = Math.max(seen.dropped, q.droppedVideoFrames);
      }
    };
    observe(true);
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        gaps.push(now - before);
        before = now;
        observe(false);
        if (now >= until) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return {
      gaps,
      decodedVideoFrames: [...decoders.values()].reduce((n, d) => n + Math.max(0, d.total - d.start), 0),
      droppedVideoFrames: [...decoders.values()].reduce(
        (n, d) => n + Math.max(0, d.dropped - d.droppedStart),
        0,
      ),
    };
  }, ms);
  const sorted = [...measured.gaps].sort((a, b) => a - b);
  return {
    frames: measured.gaps.length,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    longest: sorted.at(-1) ?? 0,
    over50: measured.gaps.filter((x) => x > 50).length,
    decodedVideoFrames: measured.decodedVideoFrames,
    droppedVideoFrames: measured.droppedVideoFrames,
  };
}

/** Read only generated PCM, after the stream has stopped. */
function toneAmplitudes(pcm: Buffer): { a: number; b: number }[] {
  const rate = 48_000,
    size = 4800;
  const amplitudes: { a: number; b: number }[] = [];
  const amplitude = (offset: number, hz: number) => {
    const coefficient = 2 * Math.cos((2 * Math.PI * hz) / rate);
    let one = 0,
      two = 0;
    for (let i = 0; i < size; i++) {
      const next = pcm.readFloatLE((offset + i) * 4) + coefficient * one - two;
      two = one;
      one = next;
    }
    return (2 * Math.sqrt(Math.max(0, one * one + two * two - coefficient * one * two))) / size;
  };
  for (let offset = 0; offset + size <= pcm.length / 4; offset += size)
    amplitudes.push({ a: amplitude(offset, 440), b: amplitude(offset, 880) });
  return amplitudes;
}

test('S5 drawing and sound cost: actual 1080p cues and two-decoder crossfades while a loopback stream encodes, three rotating rounds', async () => {
  const info = test.info();
  test.setTimeout(180_000);
  let previousAffinity: string | null = null;
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled encoder is required for S5 measuring');
  let running: Awaited<ReturnType<typeof setupVideoCue>> | null = null;
  let receiver: ReturnType<typeof rtmpListener> | null = null;
  let tracing = false;
  let tracePath: string | null = null;
  try {
    if (process.platform === 'win32') {
      previousAffinity = powershell(
        `$p=Get-Process -Id ${String(process.pid)}; $old=$p.ProcessorAffinity.ToInt64(); $p.ProcessorAffinity=3; $old`,
      );
      expect(previousAffinity).toMatch(/^\d+$/);
    }
    const setup = await setupVideoCue(true);
    running = setup;
    const { app, win, hall, stream, audio, ids, dir } = setup;
    tracePath = join(dir, 's5-drawing-trace.json');
    const mainPid = await app.evaluate(() => process.pid);
    if (process.platform === 'win32')
      expect(powershell(`(Get-Process -Id ${String(mainPid)}).ProcessorAffinity.ToInt64()`)).toBe('3');
    const features = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    expect(features.gpu_compositing).not.toBe('enabled');
    expect(features.video_decode).not.toBe('enabled');
    const port = await freePort(),
      received = join(dir, 'received.flv');
    receiver = rtmpListener(ffmpeg, port, received);
    const closed = new Promise<void>((resolve) => receiver?.once('close', () => resolve()));
    await setUpStream(app, win, port, dir, false);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const all = await d.stream.profiles(),
        p = all.profiles.find((p) => p.id === all.activeId);
      if (!p) throw new Error('No generated stream profile');
      const result = await d.stream.saveProfile(p.id, {
        name: p.name,
        url: p.url,
        preset: 'weak',
        camera: null,
        sound: null,
        soundDelayMs: 0,
        mixOwnSound: true,
      });
      if (!result.ok) throw new Error(result.message);
      await d.stream.setLayout('slides');
      const live = await d.stream.goLive({ confirmed: true });
      if (!live.ok) throw new Error(live.message);
    });
    const status = () => win.evaluate(() => (globalThis as PageGlobals).drashti.stream.status());
    let startState: {
      programOn: boolean;
      encoder: string | null;
      state: string;
      fps: number | null;
      dropped: number;
      message: string | null;
    } | null = null;
    try {
      await expect
        .poll(
          async () => {
            const s = await status();
            startState = {
              programOn: s.programOn,
              encoder: s.encoder,
              state: s.live.state,
              fps: s.live.fps,
              dropped: s.live.droppedFrames,
              message: s.live.message?.replace(/rtmps?:\/\/\S+/gu, '[loopback destination]') ?? null,
            };
            return s.live.state;
          },
          { timeout: 45_000 },
        )
        .toBe('live');
    } finally {
      await info.attach('s5-stream-start.json', {
        body: Buffer.from(JSON.stringify(startState)),
        contentType: 'application/json',
      });
    }
    const encoder = (await status()).encoder;
    if (process.platform === 'win32') expect(encoder).toMatch(/software/u);
    const playlist = await win.evaluate(async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder cost', null, false);
      if (!made.ok) throw new Error(made.message);
      const id = made.ids[0] ?? '';
      const rows = await d.playlists.addItems(
        id,
        null,
        ids.map((mediaId) => ({ kind: 'media', mediaId })),
      );
      if (!rows.ok) throw new Error(rows.message);
      await d.playlists.setWhenEnds(rows.ids[0] ?? '', 'next');
      await d.playlists.setPlayOptions(id, { shuffle: false, repeatAll: false, crossfadeMs: 2000 });
      return { id, first: rows.ids[0] ?? '' };
    }, ids);
    await beginCueDiagnostics([hall, win, stream, audio]);
    const decoderProcesses = await app.evaluate(
      ({ BrowserWindow }, pages) =>
        pages.map(({ role, url }) => ({
          role,
          pid: BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() === url)
            ?.webContents.getOSProcessId(),
        })),
      [
        { role: 'hall', url: hall.url() },
        { role: 'LIVE', url: win.url() },
        { role: 'stream', url: stream.url() },
        { role: 'sound', url: audio.url() },
      ],
    );
    const traceFiles: string[] = [];
    const streamAt = Date.now();
    const actions: { at: number; round: number; mode: string; action: string; engineAt?: number }[] = [];
    const samples: {
      round: number;
      mode: string;
      pages: Awaited<ReturnType<typeof frames>>[];
      encoderFps: number | null;
      readyAfterMs?: number;
      dropped: number;
    }[] = [];
    const modes = ['plain', 'cue', 'crossfade'];
    for (let round = 0; round < 3; round++) {
      for (let n = 0; n < 3; n++) {
        const mode = modes[(round + n) % 3] ?? 'plain';
        actions.push({ at: Date.now(), round, mode, action: 'reset to red' });
        await dispatch(win, { type: 'cancelVideoCue' });
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: ids[0], media: 'video', fit: 'fit', loop: true },
        });
        await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 0 });
        await expect(hall.locator(`video[data-media-id="${ids[0] ?? ''}"]`).first()).toHaveAttribute(
          'data-state',
          'ready',
        );
        if (mode === 'crossfade') {
          await dispatch(win, { type: 'playItem', playlistId: playlist.id, itemId: playlist.first });
          await cueReady(win);
        }
        if (mode === 'cue') {
          const began = Date.now();
          const preparation = Promise.all([hall, win, stream].map((p) => frames(p, 2300)));
          await dispatch(win, { type: 'cueVideo', mediaId: ids[1] });
          await cueReady(win);
          const readyAfterMs = Date.now() - began;
          const pages = await preparation,
            state = await status();
          samples.push({
            round,
            mode: 'cue preparing',
            pages,
            readyAfterMs,
            encoderFps: state.live.fps,
            dropped: state.live.droppedFrames,
          });
        }
        if (round === 0 && mode === 'crossfade') {
          await app.evaluate(async ({ contentTracing }) => {
            await contentTracing.startRecording({
              included_categories: ['cc', 'blink', 'devtools.timeline', 'media'],
            });
          });
          tracing = true;
        }
        // Start a fresh window after readiness, so slow preparation cannot consume the Go measurement.
        const sampling = Promise.all([hall, win, stream].map((p) => frames(p, 2300)));
        if (mode === 'cue') {
          const cue = (await snapshot(win)).videoCue;
          if (!cue) throw new Error('No prepared cue for the streaming Go measurement');
          expect((await dispatch(win, { type: 'goVideoCue', cueId: cue.id })).ok).toBe(true);
          const armed = (await snapshot(win)).videoStart;
          actions.push({ at: Date.now(), round, mode, action: 'Go', engineAt: armed?.at });
        }
        if (mode === 'crossfade') {
          await dispatch(win, { type: 'next' });
          const fade = (await snapshot(win)).videoCrossfade;
          actions.push({ at: Date.now(), round, mode, action: 'crossfade', engineAt: fade?.at });
        }
        const pages = await sampling,
          state = await status();
        if (tracing && tracePath) {
          await app.evaluate(
            async ({ contentTracing }, path) => contentTracing.stopRecording(path),
            tracePath,
          );
          tracing = false;
          traceFiles.push(tracePath);
          await info.attach('s5-drawing-trace.json', { path: tracePath, contentType: 'application/json' });
        }
        samples.push({
          round,
          mode: mode === 'cue' ? 'cue Go' : mode,
          pages,
          encoderFps: state.live.fps,
          dropped: state.live.droppedFrames,
        });
      }
    }
    const audioPictureTracks = await Promise.all(
      [audio, stream].map((page) =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLAudioElement>('audio[data-kind="video"]')].map((el) => {
            const tracks = (
              el as HTMLAudioElement & {
                videoTracks?: { length: number; [index: number]: { selected: boolean } };
              }
            ).videoTracks;
            return {
              available: tracks !== undefined,
              videos: tracks?.length ?? 0,
              selected: tracks
                ? Array.from(
                    { length: tracks.length },
                    (_, index) => tracks[index]?.selected === true,
                  ).filter(Boolean).length
                : -1,
            };
          }),
        ),
      ),
    );
    const soundPid = decoderProcesses.find((p) => p.role === 'sound')?.pid;
    const soundPictureDecodes = traceFiles.reduce((count, path) => {
      const trace = JSON.parse(readFileSync(path, 'utf8')) as {
        traceEvents?: { pid?: number; name?: string; ph?: string }[];
      };
      return (
        count +
        (trace.traceEvents ?? []).filter(
          (e) => e.pid === soundPid && e.ph === 'X' && e.name === 'vpx_codec_decode',
        ).length
      );
    }, 0);
    const ended = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.stream.end({ confirmed: true }),
    );
    expect(ended.ok).toBe(true);
    await closed;
    expect(existsSync(received)).toBe(true);
    const media = readFlv(received);
    expect(media.videoFrames).toBeGreaterThan(180);
    expect(media.audioFrames).toBeGreaterThan(100);
    const pixels = spawnSync(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        received,
        '-an',
        '-vf',
        'scale=1:1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    expect(pixels.status).toBe(0);
    let begun = false,
      black = 0;
    const blackFrameIndices: number[] = [];
    for (let at = 0; at + 2 < pixels.stdout.length; at += 3) {
      const red = pixels.stdout[at] ?? 0,
        green = pixels.stdout[at + 1] ?? 0,
        blue = pixels.stdout[at + 2] ?? 0;
      if (Math.max(red, blue) > green + 35) begun = true;
      if (begun && red + green + blue < 30) {
        black++;
        blackFrameIndices.push(at / 3);
      }
    }
    const decoded = spawnSync(
      ffmpeg,
      ['-v', 'error', '-i', received, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'],
      { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    expect(decoded.status).toBe(0);
    const amplitudes = toneAmplitudes(decoded.stdout),
      maxA = Math.max(...amplitudes.map((x) => x.a)),
      maxB = Math.max(...amplitudes.map((x) => x.b));
    let length = 0,
      longest = 0;
    for (const sample of amplitudes) {
      const a = sample.a / maxA,
        b = sample.b / maxB;
      if (a > 0.1 && a < 0.9 && b > 0.1 && b < 0.9) {
        length++;
        longest = Math.max(longest, length);
      } else length = 0;
    }
    const report = {
      system:
        process.platform === 'win32'
          ? 'two-core Windows, software drawing and decode'
          : 'Mac, software drawing and decode',
      features,
      encoder,
      samples,
      decoderProcesses,
      audioPictureTracks,
      soundPictureDecodes,
      streamAt,
      actions,
      encodedFrames: media.videoFrames,
      blackFrames: black,
      blackFrameIndices,
      toneOverlapMs: longest * 100,
      toneMaxima: { a: maxA, b: maxB },
      toneWindows: amplitudes,
    };
    await info.attach('s5-cost.json', {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    });
    await info.attach('s5-received.flv', { path: received, contentType: 'video/x-flv' });
    const { toneWindows: _toneWindows, ...summary } = report;
    console.log('S5_COST ' + JSON.stringify(summary));
    expect(begun, 'the actual encoded stream received the videos').toBe(true);
    expect(black, 'the encoded video has no black frame after its first video').toBe(0);
    expect(maxA).toBeGreaterThan(0.01);
    expect(maxB).toBeGreaterThan(0.01);
    expect(
      longest,
      'both generated tones overlap continuously through the sound crossfade',
    ).toBeGreaterThanOrEqual(12);
    expect(soundPid).toBeGreaterThan(0);
    for (const page of audioPictureTracks) {
      expect(page.length, 'the generated video sounds are playing').toBeGreaterThan(0);
      for (const tracks of page) {
        expect(tracks.available, 'sound-only track selection is supported on this system').toBe(true);
        expect(tracks.videos).toBeGreaterThan(0);
        expect(tracks.selected, 'sound players select no pictures to decode').toBe(0);
      }
    }
    expect(
      soundPictureDecodes,
      'the sound-only renderer does no picture decoding during the actual overlap',
    ).toBe(0);
  } finally {
    if (running) {
      if (tracing && tracePath) {
        await running.app.evaluate(
          async ({ contentTracing }, path) => contentTracing.stopRecording(path),
          tracePath,
        );
        await info.attach('s5-drawing-trace.json', { path: tracePath, contentType: 'application/json' });
      }
      await retainCueDiagnostics([running.hall, running.win, running.stream, running.audio], info);
    }
    receiver?.kill('SIGKILL');
    await running?.app.close();
    if (previousAffinity)
      powershell(`(Get-Process -Id ${String(process.pid)}).ProcessorAffinity=${previousAffinity}`);
  }
});
