import { beginCueDiagnostics, retainCueDiagnostics } from './video-cue-diagnostics';
import { expect, test } from '@playwright/test';
import type { Page, Worker as BrowserWorker } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { windowShowing, type PageGlobals } from './helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import { COST_BANDS, COST_SWEEPS, cueReady, setupVideoCue } from './video-cue-helpers';
import { heardFades, readSweeps, type FadeInput, type FadeSound } from './sweep-position';
import { watchPictureJumps } from './picture-jumps';
import { freePort, readFlv, rtmpListener, setUpStream, testFfmpeg } from './stream-helpers';
import {
  type PlaybackClock,
  mediaUrl,
  pageCopyUrl,
  playbackBounds,
  playbackOffset,
  playbackPosition,
} from '../../src/shared/media';
import type { VideoCrossfade } from '../../src/shared/video-cue';

/** Where one stream sound played (its element on the stream's sound page), every 50 ms. */
interface SoundStep {
  t: number;
  key: string;
  at: number;
  rate: number;
  duration: number;
  /** Jumping: silent until it lands. */
  seeking: boolean;
  /** Aimed this far ahead and heard as late (ms; QA23-FADE-4: a crossfade's incoming sound's lead), 0 for none. */
  lead: number;
}

/** How long into a fade its sounds have to be back in step (QA22-FADE-1), and how close then (ms). */
const FADE_CLOSED_AFTER_MS = 1500;
const FADE_CLOSED_WITHIN_MS = 50;
/** The most a stream sound may be off its clock at any moment of a fade (the owner: "up to ~0.1 s"). */
const FADE_MOST_OFF_MS = 100;

/**
 * QA22-FADE-1 (the owner: "Correct by speed"): each of a fade's two stream sounds, how far it was from its own clock
 * at each step from the moment the crossfade was asked until the fade's end (ms; + ahead, - behind).
 */
function fadeOffsets(
  steps: SoundStep[],
  askedAt: number,
  fade: VideoCrossfade,
  to: PlaybackClock & { mediaId: string },
): { role: 'out' | 'in'; key: string; offsets: { t: number; ms: number; rate: number }[] }[] {
  const end = fade.at + fade.durationMs;
  const sounds = [
    { role: 'out' as const, clock: fade.from, mediaId: fade.from.mediaId },
    { role: 'in' as const, clock: to, mediaId: to.mediaId },
  ];
  return sounds.map(({ role, clock, mediaId }) => {
    const key = `background:${mediaId}@${String(clock.startedAt)}`;
    const timing: PlaybackClock = {
      startedAt: clock.startedAt,
      loop: clock.loop,
      clip: clock.clip,
      seek: clock.seek,
    };
    const offsets = steps
      .filter(
        (s) => s.key === key && s.t >= askedAt && s.t < end && Number.isFinite(s.duration) && s.duration > 0,
      )
      .map((s) => {
        const { start, end: last } = playbackBounds(timing.clip, s.duration);
        const expected = playbackPosition(timing, s.duration, s.t);
        // What the mix hears (QA23-FADE-4): its player's position less its lead; before the fade's moment the lead's
        // delay still carries the silence before its start, so it is not yet behind.
        const heard = s.at - s.lead / 1000;
        const at = s.lead > 0 && s.t < fade.at && heard < expected ? expected : heard;
        return {
          t: s.t - fade.at,
          ms: Math.round(playbackOffset(at, expected, last - start, timing.loop) * 1000),
          rate: s.rate,
        };
      });
    return { role, key, offsets };
  });
}

/**
 * The page sampler's median offset for one sound between two engine moments (ms), as fadeOffsets reads it, or null
 * when it read none there: the outgoing sound's settled seconds, which anchor the recording's clock (QA23-FADE-9).
 */
function sampledMedian(
  steps: SoundStep[],
  key: string,
  clock: PlaybackClock,
  from: number,
  to: number,
): number | null {
  const offsets = steps
    .filter((s) => s.key === key && s.t >= from && s.t <= to && Number.isFinite(s.duration) && s.duration > 0)
    .map((s) => {
      const { start, end } = playbackBounds(clock.clip, s.duration);
      return playbackOffset(
        s.at - s.lead / 1000,
        playbackPosition(clock, s.duration, s.t),
        end - start,
        clock.loop,
      );
    })
    .sort((a, b) => a - b);
  const middle = offsets[Math.floor(offsets.length / 2)];
  return middle === undefined ? null : middle * 1000;
}

/**
 * Diagnostics only (a22-cue): each renderer's scheduling class now (Windows: its priority class; macOS: ps's
 * priority and nice), to see whether the stream's hidden sound page runs at a lower class than its picture page.
 */
function schedulingClasses(processes: { role: string; pid?: number }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { role, pid } of processes) {
    if (!pid) continue;
    const r =
      process.platform === 'win32'
        ? spawnSync(
            `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
            ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${String(pid)}).PriorityClass`],
            { encoding: 'utf8' },
          )
        : spawnSync('ps', ['-o', 'pri=,nice=', '-p', String(pid)], { encoding: 'utf8' });
    out[role] = r.stdout.trim();
  }
  return out;
}

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

/**
 * Lead 2's option B (QA23-FADE-9 candidate 1, S8; the owner's choice): only LIVE takes its 540p page copies, and the
 * stream's picture page plays the originals, so no second encoding reaches the stream. As built: 'both' copies.
 */
const PAGE_COPIES = 'both' as 'both' | 'live-only';
const LIVE_COPIES_ONLY = PAGE_COPIES === 'live-only';

test('S5 drawing and sound cost: actual 1080p cues and two-decoder crossfades while a loopback stream encodes, three rotating rounds', async () => {
  const info = test.info();
  test.setTimeout(180_000);
  let previousAffinity: string | null = null;
  const ffmpeg = testFfmpeg();
  if (!ffmpeg) throw new Error('The bundled encoder is required for S5 measuring');
  let running: Awaited<ReturnType<typeof setupVideoCue>> | null = null;
  // Diagnostics only (a22-cue): the stream's sound page's record is kept too (its own sounds through each fade).
  let soundRecord: Page | null = null;
  let receiver: ReturnType<typeof rtmpListener> | null = null;
  let tracing = false;
  let captureWorker: BrowserWorker | null = null;
  const retainCapture = async () => {
    const worker = captureWorker;
    captureWorker = null;
    if (!worker) return;
    const samples = await worker
      .evaluate(() => {
        const g = globalThis as { s5CaptureProbe?: { stop: () => unknown } };
        return g.s5CaptureProbe?.stop();
      })
      .catch(() => null);
    await info.attach('s5-capture-queue.json', {
      body: Buffer.from(JSON.stringify(samples)),
      contentType: 'application/json',
    });
  };
  let tracePath: string | null = null;
  try {
    if (process.platform === 'win32') {
      previousAffinity = powershell(
        `$p=Get-Process -Id ${String(process.pid)}; $old=$p.ProcessorAffinity.ToInt64(); $p.ProcessorAffinity=3; $old`,
      );
      expect(previousAffinity).toMatch(/^\d+$/);
    }
    // With each video's position sweep (QA23-FADE-9): where each sound was heard is read back from the recording.
    const setup = await setupVideoCue(
      true,
      true,
      LIVE_COPIES_ONLY ? { DRASHTI_TEST_PAGE_COPIES: 'live-only' } : {},
    );
    running = setup;
    const { app, win, hall, stream, audio, ids, dir } = setup;
    const streamSound = await windowShowing(
      app,
      (p) => p.url().includes('stream-sound.html'),
      'stream sound',
    );
    tracePath = join(dir, 's5-drawing-trace.json');
    const mainPid = await app.evaluate(() => process.pid);
    if (process.platform === 'win32')
      expect(powershell(`(Get-Process -Id ${String(mainPid)}).ProcessorAffinity.ToInt64()`)).toBe('3');
    const features = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    // The runner (lead 2, QA23-FADE-9): CI's Windows VMs differ enough between runs (the hall's frame gaps p95 31 ms on
    // one, 94 on another) that runs are compared only beside the processor, its count and the drawing they had.
    const runner = {
      processor: cpus()[0]?.model.trim() ?? 'unknown',
      logicalProcessors: cpus().length,
      gpu: features.gpu_compositing === 'enabled' ? 'hardware' : 'software',
    };
    /** The runner, beside each strict check's message (lead 2, QA23-FADE-9: runs compared fairly). */
    const note = ` [runner: ${runner.processor}, ${String(runner.logicalProcessors)} logical processors (the app held to 2), ${runner.gpu} drawing]`;
    console.log('S5_RUNNER ' + JSON.stringify(runner));
    info.annotations.push({ type: 'runner', description: note.trim() });
    expect(features.gpu_compositing).not.toBe('enabled');
    expect(features.video_decode).not.toBe('enabled');
    const port = await freePort(),
      received = join(dir, 'received.flv');
    receiver = rtmpListener(ffmpeg, port, received);
    const closed = new Promise<void>((resolve) => receiver?.once('close', () => resolve()));
    await setUpStream(app, win, port, dir, false);
    // QA23-FADE-9 candidate 1: the videos' page copies are made while idle, before the show, as Drashti makes them
    // for a crossfading playlist on a slow computer: a playlist that crossfades, then each video's 720p and 540p copies
    // ready before the stream goes on air, once its weak preset is chosen (the 720p copy is made only for a preset below
    // 1080p). A precondition only: every check is as it was.
    await win.evaluate(async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder copies', null, false);
      if (!made.ok) throw new Error(made.message);
      const id = made.ids[0] ?? '';
      const rows = await d.playlists.addItems(
        id,
        null,
        ids.map((mediaId) => ({ kind: 'media', mediaId })),
      );
      if (!rows.ok) throw new Error(rows.message);
      await d.playlists.setPlayOptions(id, { shuffle: false, repeatAll: false, crossfadeMs: 2000 });
    }, ids);
    const copiesAsked = Date.now();
    await expect
      .poll(
        async () => {
          const ready = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.pageCopies());
          return ids.every(
            (id) => (LIVE_COPIES_ONLY || (ready[id] ?? []).includes(720)) && (ready[id] ?? []).includes(540),
          );
        },
        { timeout: 60_000, message: 'each video’s page copies are made while idle' },
      )
      .toBe(true);
    // How long the copies took on this runner (a22-review-fadecopies S8: their idle-time cost), and their videos' length.
    console.log(
      'S5_COPIES ' +
        JSON.stringify({
          ms: Date.now() - copiesAsked,
          videos: ids.length,
          liveCopiesOnly: LIVE_COPIES_ONLY,
          runner: runner.processor,
        }),
    );
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
    captureWorker =
      streamSound.workers().find((worker) => worker.url().includes('encoder-audio-worker')) ?? null;
    if (!captureWorker) throw new Error('No native PCM worker for the capture cause observation');
    await captureWorker.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(AudioData.prototype, 'close');
      if (!original) throw new Error('No native audio frame closer');
      const rows: { at: number; timestamp: number; frames: number }[] = [];
      const post = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'postMessage');
      if (!post) throw new Error('No native PCM port sender');
      const tones: { at: number; a: number; b: number }[] = [];
      const coefficientA = 2 * Math.cos((2 * Math.PI * 440) / 48_000);
      const coefficientB = 2 * Math.cos((2 * Math.PI * 880) / 48_000);
      let count = 0,
        oneA = 0,
        twoA = 0,
        oneB = 0,
        twoB = 0;
      Object.defineProperty(MessagePort.prototype, 'postMessage', {
        ...post,
        value(this: MessagePort, ...args: unknown[]) {
          const message = args[0] as { kind?: string; data?: unknown; frames?: number } | null;
          if (
            message?.kind === 'audio' &&
            message.data instanceof ArrayBuffer &&
            typeof message.frames === 'number'
          ) {
            const values = new Float32Array(message.data);
            for (let frame = 0; frame < message.frames; frame++) {
              const sample = ((values[frame * 2] ?? 0) + (values[frame * 2 + 1] ?? 0)) / 2;
              const nextA = sample + coefficientA * oneA - twoA;
              const nextB = sample + coefficientB * oneB - twoB;
              twoA = oneA;
              oneA = nextA;
              twoB = oneB;
              oneB = nextB;
              if (++count === 4800) {
                tones.push({
                  at: Date.now(),
                  a:
                    (2 * Math.sqrt(Math.max(0, oneA * oneA + twoA * twoA - coefficientA * oneA * twoA))) /
                    4800,
                  b:
                    (2 * Math.sqrt(Math.max(0, oneB * oneB + twoB * twoB - coefficientB * oneB * twoB))) /
                    4800,
                });
                count = oneA = twoA = oneB = twoB = 0;
              }
            }
          }
          (post.value as (this: MessagePort, ...args: unknown[]) => void).apply(this, args);
        },
      });
      Object.defineProperty(AudioData.prototype, 'close', {
        ...original,
        value(this: AudioData) {
          if (rows.length < 60_000)
            rows.push({ at: Date.now(), timestamp: this.timestamp, frames: this.numberOfFrames });
          (original.value as (this: AudioData) => void).call(this);
        },
      });
      (globalThis as { s5CaptureProbe?: { stop: () => unknown } }).s5CaptureProbe = {
        stop: () => {
          Object.defineProperty(AudioData.prototype, 'close', original);
          Object.defineProperty(MessagePort.prototype, 'postMessage', post);
          return { rows, tones };
        },
      };
    });
    await beginCueDiagnostics([hall, win, stream, audio]);
    // The sound page draws nothing: its event loop's lag is recorded too (diagnostics only, a22-cue).
    await beginCueDiagnostics([streamSound], { lag: true });
    soundRecord = streamSound;
    // A sound player that ran out of decoded sound while it played (its 'waiting' after 'playing', not a jump's):
    // a hole in that page's sound. Recorded on the stream's page and, to compare, the hall's audio player.
    const underflowWatch = (page: Page) =>
      page.evaluate(() => {
        const seen: { at: number; key: string; currentTime: number; readyState: number }[] = [];
        const jumps: { at: number; key: string }[] = [];
        (globalThis as { s5SoundJumps?: typeof jumps }).s5SoundJumps = jumps;
        const playing = new WeakSet<EventTarget>();
        const own = (target: EventTarget | null): target is HTMLAudioElement =>
          target instanceof HTMLAudioElement && target.dataset['key'] !== undefined;
        document.addEventListener(
          'playing',
          (e) => {
            if (own(e.target)) playing.add(e.target);
          },
          true,
        );
        document.addEventListener(
          'seeking',
          (e) => {
            if (own(e.target)) {
              playing.delete(e.target);
              jumps.push({ at: Date.now(), key: e.target.dataset['key'] ?? '' });
            }
          },
          true,
        );
        document.addEventListener(
          'waiting',
          (e) => {
            const el = e.target;
            if (!own(el) || !playing.has(el) || el.seeking || el.paused) return;
            playing.delete(el);
            seen.push({
              at: Date.now(),
              key: el.dataset['key'] ?? '',
              currentTime: el.currentTime,
              readyState: el.readyState,
            });
          },
          true,
        );
        (globalThis as { s5SoundUnderflows?: typeof seen }).s5SoundUnderflows = seen;
      });
    await Promise.all([streamSound, audio].map(underflowWatch));
    // QA22-FADE-1: where each stream sound plays, every 50 ms (read against its clock afterwards, by fadeOffsets).
    await streamSound.evaluate(() => {
      const steps: {
        t: number;
        key: string;
        at: number;
        rate: number;
        duration: number;
        seeking: boolean;
        lead: number;
      }[] = [];
      (globalThis as { s5SoundSteps?: typeof steps }).s5SoundSteps = steps;
      setInterval(() => {
        if (steps.length > 60_000) return;
        for (const el of document.querySelectorAll<HTMLAudioElement>('audio[data-key^="background:"]'))
          steps.push({
            t: Date.now(),
            key: el.dataset['key'] ?? '',
            at: el.currentTime,
            rate: el.playbackRate,
            duration: el.duration,
            seeking: el.seeking,
            lead: Number(el.dataset['leadMs'] ?? 0),
          });
      }, 50);
    });
    // a22-review-x86 S7 (166383843's observer, here where it can run: the stream mixes its own sound): each fade's two
    // crossfade gains on the stream's sound page, as each is written. The envelope follows the engine's time, never a
    // player's own position, whatever QA22-FADE-1's speed does to the player.
    await streamSound.evaluate(() => {
      const trace: { t: number; gains: number[] }[] = [];
      (globalThis as { s5SoundGains?: typeof trace }).s5SoundGains = trace;
      new MutationObserver(() => {
        if (trace.length > 20_000) return;
        const gains = [...document.querySelectorAll<HTMLElement>('audio[data-crossfade-gain]')].map((el) =>
          Number(el.dataset['crossfadeGain']),
        );
        if (gains.length === 2 && gains.every(Number.isFinite)) trace.push({ t: Date.now(), gains });
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-crossfade-gain'],
      });
    });
    // Lead 2's QF-1 (a22-fade-picture): each background picture's jumps on the hall, LIVE and the stream's picture page.
    // A jumping picture is frozen until it lands; one sent again as it lands stays frozen (its 'seeked' comes with it
    // seeking again), and one let go of before it landed was frozen until then.
    const pictureJumpWatch = async (page: Page) => {
      await page.evaluate(watchPictureJumps);
      await page.evaluate(() => {
        // QA23-FADE-6 (B), evidence: each picture's clock as it changes (data-cue-clock: 'graph' a cue's, 'fade' its
        // crossfade's, none its own muted one).
        const clocks: {
          key: string;
          clock: string | null;
          t: number;
          // a22-review-fade's SHOULD: the picture's own time every 20 ms for 600 ms from the change (its sound moved to
          // the graph mid-play: a stall there is not a jump, so the strict check would not see it).
          times: { t: number; at: number; paused: boolean }[];
        }[] = [];
        (globalThis as { s5PictureClocks?: typeof clocks }).s5PictureClocks = clocks;
        new MutationObserver((records) => {
          for (const r of records) {
            const el = r.target;
            if (!(el instanceof HTMLVideoElement) || clocks.length >= 200) continue;
            const change = {
              key: el.dataset['bgSlot'] ?? '',
              clock: el.dataset['cueClock'] ?? null,
              t: Date.now(),
              times: [{ t: Date.now(), at: el.currentTime, paused: el.paused }],
            };
            clocks.push(change);
            const sample = () => {
              change.times.push({ t: Date.now(), at: el.currentTime, paused: el.paused });
              if (Date.now() < change.t + 600 && el.isConnected) setTimeout(sample, 20);
            };
            setTimeout(sample, 20);
          }
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-cue-clock'] });
      });
    };
    await Promise.all([hall, win, stream].map(pictureJumpWatch));
    const fadeClocks: { askedAt: number; fade: VideoCrossfade; to: PlaybackClock & { mediaId: string } }[] =
      [];
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
        { role: 'stream sound', url: streamSound.url() },
        { role: 'sound', url: audio.url() },
      ],
    );
    const traceFiles: string[] = [];
    const classes: { round: number; at: number; classes: Record<string, string> }[] = [
      { round: -1, at: Date.now(), classes: schedulingClasses(decoderProcesses) },
    ];
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
        // The outgoing sound's clock and the fade's length before the crossfade (QA22-FADE-1's offsets).
        let fadeBefore: Awaited<ReturnType<typeof snapshot>> | null = null;
        if (mode === 'crossfade') {
          await dispatch(win, { type: 'playItem', playlistId: playlist.id, itemId: playlist.first });
          await cueReady(win);
          fadeBefore = await snapshot(win);
          // The outgoing sound given its chance to settle first, as a video that has played a while has when it
          // crossfades: playing, not jumping, within 0.05 s of its clock (the fade's own strict bound is 0.1 s). It
          // began only ~3 s before, and on CI's two-core Windows its start's jumps landed 0.9-1.5 s late one by one,
          // so it came into a fade 1.5 s off and jumped there (a22-fade-1124-103850-84601). The wait ends a second
          // before the playlist's own crossfade would start by itself; settled or not, Next then crossfades and the
          // fade's own sound is judged as before (`settled` in the report).
          const outgoing = fadeBefore.layers.background;
          if (outgoing?.kind !== 'media') throw new Error('No outgoing video before the crossfade');
          const outgoingClock: PlaybackClock = {
            startedAt: outgoing.startedAt,
            loop: outgoing.loop,
            clip: outgoing.clip,
            seek: outgoing.seek,
          };
          const by = (fadeBefore.videoCue?.automatic?.at ?? Date.now()) - 1000;
          let settled = false;
          try {
            await expect
              .poll(
                async () => {
                  const seen = await streamSound.evaluate(
                    (key) => {
                      const el = document.querySelector<HTMLAudioElement>(`audio[data-key="${key}"]`);
                      return el
                        ? {
                            t: Date.now(),
                            at: el.currentTime,
                            seeking: el.seeking,
                            paused: el.paused,
                            duration: el.duration,
                          }
                        : null;
                    },
                    `background:${outgoing.mediaId}@${String(outgoing.startedAt)}`,
                  );
                  if (!seen || seen.seeking || seen.paused || !(seen.duration > 0)) return false;
                  const { start, end } = playbackBounds(outgoingClock.clip, seen.duration);
                  const expected = playbackPosition(outgoingClock, seen.duration, seen.t);
                  return Math.abs(playbackOffset(seen.at, expected, end - start, outgoingClock.loop)) < 0.05;
                },
                { timeout: Math.max(1, by - Date.now()) },
              )
              .toBe(true);
            settled = true;
          } catch {
            // Not settled in time: crossfaded as it is, and judged as it is.
          }
          actions.push({
            at: Date.now(),
            round,
            mode,
            action: settled ? 'outgoing settled' : 'outgoing not settled',
          });
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
          // Only 'media' (lead 2, 24 Nov): what the sound renderer's no-picture-decoding check reads (vpx_codec_decode).
          // The wider trace ('cc', 'blink', 'devtools.timeline') starved the stream sound page's 50 ms sampler on CI's
          // two-core Windows: 6 samples in this fade (a22-fade-1124-145657-55108) against the 20 its checks need.
          await app.evaluate(async ({ contentTracing }) => {
            await contentTracing.startRecording({ included_categories: ['media'] });
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
          const askedAt = Date.now();
          await dispatch(win, { type: 'next' });
          const after = await snapshot(win);
          const fade = after.videoCrossfade;
          actions.push({ at: Date.now(), round, mode, action: 'crossfade', engineAt: fade?.at });
          // Both sounds' clocks as the engine set them (QA22-FADE-1's offsets): the outgoing is the background before,
          // the incoming starts at the fade's moment (its seek). Not from the fade alone: on a slow computer this
          // snapshot can come after the 2 s fade is over (its pair gone, as in a22-cue-1124-020305-89756).
          const from = fadeBefore?.layers.background,
            to = after.layers.background,
            durationMs = fade?.durationMs ?? fadeBefore?.videoCue?.automatic?.durationMs;
          if (
            from?.kind === 'media' &&
            from.media === 'video' &&
            to?.kind === 'media' &&
            to.seek &&
            durationMs
          )
            fadeClocks.push({
              askedAt,
              fade: { id: fade?.id ?? '', from: { ...from, media: 'video' }, at: to.seek.at, durationMs },
              to,
            });
          classes.push({ round, at: Date.now(), classes: schedulingClasses(decoderProcesses) });
        }
        const pages = await sampling,
          state = await status();
        // a22-review-fadecopies S12: which file each page plays, in the first crossfade: the hall's screens every
        // original, LIVE its videos' 540p copies and the stream's picture page (the weak preset) their 720p ones.
        if (mode === 'crossfade' && round === 0) {
          const sources = (page: Page) =>
            page.evaluate(() =>
              [...document.querySelectorAll<HTMLVideoElement>('video[data-media-id]')]
                .map((v) => ({ id: v.dataset['mediaId'] ?? '', src: v.getAttribute('src') ?? '' }))
                .filter((v) => v.src !== ''),
            );
          const [onHall, onLive, onStream] = await Promise.all([hall, win, stream].map(sources));
          const ours = (list: { id: string; src: string }[] | undefined) =>
            (list ?? []).filter((v) => ids.includes(v.id));
          expect(ours(onHall).length, 'the hall plays the videos').toBeGreaterThan(0);
          expect(
            ours(onHall).filter((v) => v.src !== mediaUrl(v.id)),
            'the hall’s screens play every original',
          ).toEqual([]);
          expect(
            ours(onLive).some((v) => v.src === pageCopyUrl(v.id, 540)),
            'LIVE plays a video’s 540p page copy',
          ).toBe(true);
          expect(
            ours(onStream).filter(
              (v) => v.src !== (LIVE_COPIES_ONLY ? mediaUrl(v.id) : pageCopyUrl(v.id, 720)),
            ),
            LIVE_COPIES_ONLY
              ? 'the stream’s picture page plays every original (option B)'
              : 'the stream’s picture page plays the videos’ 720p page copies',
          ).toEqual([]);
          expect(ours(onStream).length).toBeGreaterThan(0);
        }
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
      [audio, streamSound].map((page) =>
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
    const streamSoundAhead = await streamSound.evaluate(() =>
      [...document.querySelectorAll<HTMLAudioElement>('audio[data-key]')].map((el) => ({
        asked: el.dataset['soundAhead'] ?? null,
        latencyHint: (el as HTMLAudioElement & { latencyHint?: number }).latencyHint ?? null,
      })),
    );
    const soundPid = decoderProcesses.find((p) => p.role === 'sound')?.pid;
    const soundPictureDecodes = traceFiles.reduce((count, path) => {
      const trace = JSON.parse(readFileSync(path, 'utf8')) as {
        traceEvents?: { pid?: number; name?: string; ph?: string }[];
      };
      return (
        count +
        (trace.traceEvents ?? []).filter(
          (e) =>
            (e.pid === soundPid || e.pid === decoderProcesses.find((p) => p.role === 'stream sound')?.pid) &&
            e.ph === 'X' &&
            e.name === 'vpx_codec_decode',
        ).length
      );
    }, 0);
    const [streamUnderflows, soundUnderflows] = await Promise.all(
      [streamSound, audio].map((page) =>
        page.evaluate(
          () =>
            (
              globalThis as {
                s5SoundUnderflows?: { at: number; key: string; currentTime: number; readyState: number }[];
              }
            ).s5SoundUnderflows ?? null,
        ),
      ),
    );
    const streamSoundJumps = await streamSound.evaluate(
      () => (globalThis as { s5SoundJumps?: { at: number; key: string }[] }).s5SoundJumps ?? [],
    );
    const fadeJumps = streamSoundJumps.filter((jump) =>
      actions.some(
        (action) =>
          action.action === 'crossfade' &&
          action.engineAt !== undefined &&
          jump.at >= action.engineAt &&
          jump.at < action.engineAt + 2000,
      ),
    );
    // QA22-FADE-1: each fade's two sounds against their clocks, and any moment of a fade a sound was still jumping
    // (a jump begun before the fade that lands inside it is a silence in the fade too: CI Windows, 1.9 s).
    const soundSteps = await streamSound.evaluate(
      () => (globalThis as { s5SoundSteps?: SoundStep[] }).s5SoundSteps ?? [],
    );
    const fadeSteps = fadeClocks.map(({ askedAt, fade, to }) => ({
      at: fade.at,
      durationMs: fade.durationMs,
      sounds: fadeOffsets(soundSteps, askedAt, fade, to),
      silent: soundSteps
        .filter((s) => s.seeking && s.t >= fade.at && s.t < fade.at + fade.durationMs)
        .filter(
          (s) =>
            s.key === `background:${fade.from.mediaId}@${String(fade.from.startedAt)}` ||
            s.key === `background:${to.mediaId}@${String(to.startedAt)}`,
        )
        .map((s) => ({ t: s.t - fade.at, key: s.key })),
    }));
    const soundGains = await streamSound.evaluate(
      () => (globalThis as { s5SoundGains?: { t: number; gains: number[] }[] }).s5SoundGains ?? [],
    );
    const fadeGains = fadeClocks.map(({ fade }) => ({
      at: fade.at,
      durationMs: fade.durationMs,
      gains: soundGains.filter((g) => g.t >= fade.at && g.t < fade.at + fade.durationMs),
    }));
    // Lead 2's QF-1: each moment of a fade a picture on the hall, LIVE or the stream's page was frozen in a jump (one
    // begun before the fade that lands in it counts, as for the sound).
    const pictureJumps = await Promise.all(
      [hall, win, stream].map((page) =>
        page.evaluate(
          () =>
            (
              globalThis as {
                s5PictureJumps?: { key: string; from: number; to: number | null; left: number | null }[];
              }
            ).s5PictureJumps ?? null,
        ),
      ),
    );
    const pictureFreezes = fadeClocks.flatMap(({ fade }) =>
      (['hall', 'LIVE', 'stream'] as const).flatMap((role, index) =>
        (pictureJumps[index] ?? [])
          .map((jump) => ({
            key: jump.key,
            from: Math.max(jump.from, fade.at),
            to: Math.min(jump.to ?? Number.POSITIVE_INFINITY, fade.at + fade.durationMs),
            open: jump.to === null,
            left: jump.left,
          }))
          .filter((jump) => jump.to > jump.from)
          .map((jump) => ({
            fadeAt: fade.at,
            role,
            key: jump.key,
            t: jump.from - fade.at,
            ms: jump.to - jump.from,
            // QFP-11 B, a record: a jump still open at the end, and when its element left the page (ms from the
            // fade's start), which ends it there (the owner's QFP-6 item 3).
            ...(jump.open ? { stillOpen: true } : {}),
            ...(jump.left === null ? {} : { leftPageMs: jump.left - fade.at }),
          })),
      ),
    );
    await retainCapture();
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
      black = 0,
      // Lead 2's QF-1, evidence only: frames that show the two generated videos (red, blue) blended. CI's Windows
      // recordings had none in 11 of 13 since x69 (the Mac about 40 a fade): its encoder, below normal, dropped them.
      blended = 0;
    const blackFrameIndices: number[] = [];
    for (let at = 0; at + 2 < pixels.stdout.length; at += 3) {
      const red = pixels.stdout[at] ?? 0,
        green = pixels.stdout[at + 1] ?? 0,
        blue = pixels.stdout[at + 2] ?? 0;
      if (Math.max(red, blue) > green + 35) begun = true;
      if (red + blue > 60 && blue / (red + blue) > 0.3 && blue / (red + blue) < 0.7) blended++;
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
    // QA23-FADE-9 (the owner: "Read it from the recording (Rec.)"): where each fade's two sounds were HEARD, from the
    // position sweep in the stream's own recording, every 20 ms where each one's gain is at least 0.1; the recording's
    // clock anchored by the outgoing sound's settled seconds before the ask. No page thread is in the way.
    const recording = Float32Array.from({ length: Math.floor(decoded.stdout.length / 4) }, (_, i) =>
      decoded.stdout.readFloatLE(i * 4),
    );
    const heardSound = (role: 'out' | 'in', clock: PlaybackClock & { mediaId: string }): FadeSound => {
      const key = `background:${clock.mediaId}@${String(clock.startedAt)}`;
      const band = ids.indexOf(clock.mediaId);
      const timing: PlaybackClock = {
        startedAt: clock.startedAt,
        loop: clock.loop,
        clip: clock.clip,
        seek: clock.seek,
      };
      const duration =
        soundSteps.find((s) => s.key === key && Number.isFinite(s.duration) && s.duration > 0)?.duration ??
        NaN;
      return {
        role,
        key,
        band,
        sweep: COST_SWEEPS[band === 1 ? 1 : 0],
        offset: (heard, at) => {
          const { start, end } = playbackBounds(timing.clip, duration);
          return (
            playbackOffset(heard, playbackPosition(timing, duration, at), end - start, timing.loop) * 1000
          );
        },
      };
    };
    const heardInputs: FadeInput[] = fadeClocks.map(({ askedAt, fade, to }) => {
      const from: PlaybackClock & { mediaId: string } = {
        startedAt: fade.from.startedAt,
        loop: fade.from.loop,
        clip: fade.from.clip,
        seek: fade.from.seek,
        mediaId: fade.from.mediaId,
      };
      return {
        askedAt,
        at: fade.at,
        durationMs: fade.durationMs,
        sounds: [heardSound('out', from), heardSound('in', to)],
        settledMs: sampledMedian(
          soundSteps,
          `background:${from.mediaId}@${String(from.startedAt)}`,
          from,
          askedAt - 1000,
          askedAt - 100,
        ),
      };
    });
    const heard = heardFades(readSweeps(recording, 48_000, COST_BANDS), heardInputs);
    const report = {
      runner,
      system:
        process.platform === 'win32'
          ? 'two-core Windows, software drawing and decode'
          : 'Mac, software drawing and decode',
      features,
      encoder,
      samples,
      decoderProcesses,
      classes,
      audioPictureTracks,
      soundPictureDecodes,
      streamAt,
      actions,
      soundUnderflows: { stream: streamUnderflows, sound: soundUnderflows },
      streamSoundAhead,
      streamSoundJumps,
      fadeJumps,
      fadeSteps,
      heardFades:
        'error' in heard
          ? heard
          : heard.fades.map((f) => ({
              at: f.at,
              anchor: f.anchor,
              sounds: f.sounds.map((sound) => ({
                role: sound.role,
                key: sound.key,
                readings: sound.readings.map((r) => [Math.round(r.t), Math.round(r.ms)]),
              })),
            })),
      fadeGains,
      encodedFrames: media.videoFrames,
      blackFrames: black,
      blackFrameIndices,
      blendedFrames: blended,
      pictureJumpsSeen: pictureJumps.map((jumps) => jumps?.length ?? null),
      pictureClocks: await Promise.all(
        [hall, win, stream].map(async (page) => {
          const changes = await page.evaluate(
            () =>
              (
                globalThis as {
                  s5PictureClocks?: {
                    key: string;
                    clock: string | null;
                    t: number;
                    times: { t: number; at: number; paused: boolean }[];
                  }[];
                }
              ).s5PictureClocks ?? null,
          );
          // Evidence only: the longest its time stood still while playing in those 600 ms (ms).
          return changes?.map((change) => {
            let longestStillMs = 0,
              since: number | null = null;
            for (const [i, sample] of change.times.entries()) {
              const before = change.times[i - 1];
              if (before && !sample.paused && sample.at === before.at) {
                since ??= before.t;
                longestStillMs = Math.max(longestStillMs, sample.t - since);
              } else since = null;
            }
            return { ...change, longestStillMs };
          });
        }),
      ),
      pictureFreezes,
      toneOverlapMs: longest * 100,
      toneMaxima: { a: maxA, b: maxB },
      toneWindows: amplitudes,
    };
    await info.attach('s5-cost.json', {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    });
    await info.attach('s5-received.flv', { body: readFileSync(received), contentType: 'video/x-flv' });
    await info.attach('s5-encoded-pixels.rgb', {
      body: pixels.stdout,
      contentType: 'application/octet-stream',
    });
    const { toneWindows: _toneWindows, ...summary } = report;
    console.log('S5_COST ' + JSON.stringify(summary));
    expect(begun, 'the actual encoded stream received the videos').toBe(true);
    expect(black, 'the encoded video has no black frame after its first video').toBe(0);
    expect(maxA).toBeGreaterThan(0.01);
    expect(maxB).toBeGreaterThan(0.01);
    expect(streamUnderflows, 'the stream page’s sound players are watched').not.toBeNull();
    expect(
      streamUnderflows,
      'the stream’s own sound players never run out of decoded sound while they play',
    ).toEqual([]);
    expect(
      longest,
      'both generated tones overlap continuously through the sound crossfade',
    ).toBeGreaterThanOrEqual(12);
    expect(streamSoundAhead.length, 'the stream page plays its own sound').toBeGreaterThan(0);
    for (const player of streamSoundAhead)
      expect(player, 'each stream sound player keeps a second of sound decoded ahead').toEqual({
        asked: '1',
        latencyHint: 1,
      });
    expect(fadeJumps, `stream sound never jumps during a fade behind picture decoding${note}`).toEqual([]);
    // QA22-FADE-1 (the owner: "Correct by speed"): a stream sound out of step in a fade is brought back by speed:
    // never silent in a jump, never more than ~0.1 s off its clock, and back within 0.05 s 1.5 s into the fade.
    expect(fadeSteps.length, 'every crossfade round had its two sounds’ clocks').toBe(3);
    for (const fade of fadeSteps) {
      expect(fade.silent, `no stream sound is still jumping (silent) at any moment of a fade${note}`).toEqual(
        [],
      );
      // Where the page's sampler saw a sound, the bounds hold; its floor is counted where the sound was heard (below).
      for (const sound of fade.sounds) {
        expect(
          Math.max(...sound.offsets.map((o) => Math.abs(o.ms))),
          `the ${sound.role} sound stays within ${String(FADE_MOST_OFF_MS)} ms of its clock through the fade`,
        ).toBeLessThanOrEqual(FADE_MOST_OFF_MS);
        expect(
          sound.offsets.filter((o) => o.t >= FADE_CLOSED_AFTER_MS && Math.abs(o.ms) > FADE_CLOSED_WITHIN_MS),
          `the ${sound.role} sound is back within ${String(FADE_CLOSED_WITHIN_MS)} ms of its clock ${String(FADE_CLOSED_AFTER_MS)} ms into the fade`,
        ).toEqual([]);
      }
    }
    // QA23-FADE-9 (the owner: "Read it from the recording (Rec.)"): the same strict bounds where each sound was heard,
    // read from the stream's recording by its position sweep, and the floor of 20 readings a sound a fade counted there
    // (where its gain is at least 0.1). The page's 50 ms sampler starved for 0.77-0.81 s at a fade's start on CI's
    // two-core Windows (a22-fadeprep-1125-084705-80663), while the sound itself stayed in step.
    expect(heard, `the stream recording’s position sweeps are read for every fade${note}`).not.toHaveProperty(
      'error',
    );
    const heardList = 'fades' in heard ? heard.fades : [];
    expect(heardList.length, 'every crossfade is heard in the recording').toBe(fadeSteps.length);
    for (const fade of heardList)
      for (const sound of fade.sounds) {
        expect(
          sound.readings.length,
          `the ${sound.role} sound is heard through the fade (read where its gain is at least 0.1)${note}`,
        ).toBeGreaterThanOrEqual(20);
        expect(
          Math.max(...sound.readings.map((r) => Math.abs(r.ms))),
          `the ${sound.role} sound is heard within ${String(FADE_MOST_OFF_MS)} ms of its clock through the fade${note}`,
        ).toBeLessThanOrEqual(FADE_MOST_OFF_MS);
        expect(
          sound.readings
            .filter((r) => r.t >= FADE_CLOSED_AFTER_MS && Math.abs(r.ms) > FADE_CLOSED_WITHIN_MS)
            .map((r) => ({ t: Math.round(r.t), ms: Math.round(r.ms) })),
          `the ${sound.role} sound is heard back within ${String(FADE_CLOSED_WITHIN_MS)} ms of its clock ${String(FADE_CLOSED_AFTER_MS)} ms into the fade${note}`,
        ).toEqual([]);
      }
    // Lead 2's QF-1: a crossfade's pictures are brought back by speed, not jumps, on the hall, LIVE and the stream's
    // page: none is frozen in a jump at any moment of a fade (CI's Windows, a22-fade-1124-103850-84620: 0.6 to 4.4 s of
    // each 2 s fade on a page; the Mac 13 to 230 ms).
    expect(pictureJumps, 'the hall’s, LIVE’s and the stream page’s pictures are watched').not.toContain(null);
    // QFP-11 B, in the message only: how many of these ended as their element left the page (QFP-6 item 3).
    const gone = pictureFreezes.filter((f) => 'leftPageMs' in f).length;
    expect(
      pictureFreezes,
      `no picture on the hall, LIVE or the stream’s page is frozen in a jump at any moment of a fade${note}${gone > 0 ? ` [${String(gone)} of ${String(pictureFreezes.length)} until their element left the page: QFP-6 item 3]` : ''}`,
    ).toEqual([]);
    // S7: the stream's own two sounds cross by the engine's fade, as the hall's audio player's do in the crossfade case
    // (back since applyLevels reads the engine's time once for all its sounds: a22-fade-1124-103850-84601's one sample
    // of ~100 had the outgoing gain 63 ms stale, two reads split on a starved two-core runner, a22-review-fade R2-S3).
    for (const fade of fadeGains) {
      expect(
        fade.gains.length,
        'the stream sound page’s crossfade gains are seen through each fade',
      ).toBeGreaterThanOrEqual(10);
      let previous = -1;
      for (const frame of fade.gains) {
        const incoming = frame.gains[1] ?? -1;
        expect((frame.gains[0] ?? -1) + incoming, 'the two gains sum to one').toBeCloseTo(1, 2);
        expect(incoming, 'the incoming gain only rises').toBeGreaterThanOrEqual(previous - 0.001);
        expect(
          Math.abs(incoming - Math.max(0, Math.min(1, (frame.t - fade.at) / fade.durationMs))),
          `the incoming gain follows the engine’s fade (the sound page writes it every 50 ms)${note}`,
        ).toBeLessThanOrEqual(0.04);
        previous = incoming;
      }
    }
    const streamSoundPid = decoderProcesses.find((p) => p.role === 'stream sound')?.pid;
    expect(streamSoundPid).toBeGreaterThan(0);
    expect(streamSoundPid, 'sound has its own renderer and media thread').not.toBe(
      decoderProcesses.find((p) => p.role === 'stream')?.pid,
    );
    expect(await stream.locator('audio').count(), 'picture renderer owns no sound players').toBe(0);
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
    await retainCapture();
    if (running) {
      if (tracing && tracePath) {
        await running.app.evaluate(
          async ({ contentTracing }, path) => contentTracing.stopRecording(path),
          tracePath,
        );
        await info.attach('s5-drawing-trace.json', { path: tracePath, contentType: 'application/json' });
      }
      await retainCueDiagnostics(
        [running.hall, running.win, running.stream, running.audio, ...(soundRecord ? [soundRecord] : [])],
        info,
      );
    }
    receiver?.kill('SIGKILL');
    await running?.app.close();
    if (previousAffinity)
      powershell(`(Get-Process -Id ${String(process.pid)}).ProcessorAffinity=${previousAffinity}`);
  }
});
