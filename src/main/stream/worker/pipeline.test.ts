import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  fdatasync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import type { MkvCluster } from './mkv';
import { MkvSplitter } from './mkv';
import { StreamPipeline } from './pipeline';
import type { WorkerStatus } from './protocol';

/*
 * The pipeline with the real FFmpeg (where it has been fetched: macOS and
 * Windows CI, and the dev Mac), generated frames and a tone, and FFmpeg
 * listening for RTMP on this computer in YouTube's place. A made-up key.
 */

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);
const KEY = 'test-made-up-key-pipeline-0000';
const preset = { ...STREAM_PRESETS.weak, width: 320, height: 180, videoKbps: 800 };

let dir = '';
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  // Windows lets a file go only once the process that had it open has gone: try again for a moment.
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const a = server.address();
      server.close(() => {
        resolve(typeof a === 'object' && a ? a.port : 0);
      });
    });
  });
}

function listener(port: number, file: string): ChildProcess {
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-listen',
      '1',
      '-i',
      `rtmp://127.0.0.1:${port}/live2/${KEY}`,
      '-c',
      'copy',
      '-f',
      'flv',
      '-y',
      file,
    ],
    // The listener, YouTube's stand-in, never writes a report of its own (a test sets FFREPORT for Drashti).
    { stdio: 'ignore', env: withoutReport() },
  );
  children.push(child);
  return child;
}

function withoutReport(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['FFREPORT'];
  return env;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

/**
 * Frames (a grey that changes) and sound (a 440 Hz tone, 0.2 unless `loud` says otherwise), 1/30 s at a
 * time, until stopped; and the seconds fed so far (the recording's own time: a slow runner's timer can
 * fall behind the clock).
 */
function feed(
  p: StreamPipeline,
  loud: { amplitude: number } = { amplitude: 0.2 },
): { stop: () => void; fed: () => number } {
  p.fromProgram({ kind: 'format', width: preset.width, height: preset.height, format: 'I420' });
  let n = 0;
  const timer = setInterval(() => {
    const frame = new Uint8Array((preset.width * preset.height * 3) / 2).fill((n * 7) % 255);
    p.fromProgram({ kind: 'video', data: frame.buffer });
    const audio = new Float32Array(1600 * 2).map(
      (_, i) => loud.amplitude * Math.sin((2 * Math.PI * 440 * (n * 1600 + (i >> 1))) / 48_000),
    );
    p.fromProgram({ kind: 'audio', data: audio.buffer, frames: 1600 });
    n++;
  }, 1000 / 30);
  return {
    stop: () => {
      clearInterval(timer);
    },
    fed: () => n / 30,
  };
}

/**
 * A recording's sound as the bundled FFmpeg reads it back: its peak and RMS (dBFS), from 0.5 s in and
 * without stretches of silence (a slow runner's feed can stall, and silence keeps the time meanwhile).
 */
function soundLevels(file: string): { peak: number; rms: number } {
  const r = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-af',
      'atrim=start=0.5,silenceremove=stop_periods=-1:stop_duration=0.05:stop_threshold=-60dB,astats=metadata=0:reset=0',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', env: withoutReport() },
  );
  const overall = r.stderr.slice(r.stderr.lastIndexOf('Overall'));
  const value = (name: string) =>
    Number(new RegExp(`${name}: (-?[0-9.]+|-inf)`, 'u').exec(overall)?.[1] ?? NaN);
  return { peak: value('Peak level dB'), rms: value('RMS level dB') };
}

describe.skipIf(!existsSync(ffmpeg))('the stream pipeline, with FFmpeg', () => {
  it('records and sends; a dropped connection is made again while the recording carries on', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const port = await freePort();
    const logs: string[] = [];
    const seen: { status: WorkerStatus | null } = { status: null };
    const p = new StreamPipeline({
      status: (s) => {
        seen.status = s;
      },
      log: (_level, line) => {
        logs.push(line);
      },
    });
    const current = () => seen.status;
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const { stop, fed } = feed(p);
    // When the connection dropped, in the recording's own time (the seconds fed since it started).
    let droppedAt = 0;
    try {
      const first = listener(port, join(dir, 'first.flv'));
      await sleep(500);
      const recordedFrom = fed();
      p.record(join(dir, 'recording.mkv'), 1024 ** 2);
      p.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
      await until('on air', () => current()?.live.state === 'live');
      await sleep(3000);
      droppedAt = fed() - recordedFrom;
      first.kill('SIGKILL');
      await until('reconnecting', () => current()?.live.state === 'reconnecting');
      await sleep(1500);
      listener(port, join(dir, 'second.flv'));
      await until('on air again', () => current()?.live.state === 'live', 40_000).catch((error: unknown) => {
        throw new Error(`${String(error)}\n${logs.join('\n')}`);
      });
      await sleep(3000);
      // Six seconds recorded since the drop, however slowly the frames come.
      await until('six seconds since the drop', () => fed() - recordedFrom > droppedAt + 6);
      expect(current()?.live.reconnects).toBeGreaterThanOrEqual(1);
      p.endLive();
      p.stopRecording();
    } finally {
      stop();
      p.stop();
    }
    await sleep(1000);
    // The second connection received the stream (the first listener was killed, so its file is cut
    // short), and the key never reached a log line.
    expect(statSync(join(dir, 'second.flv')).size).toBeGreaterThan(1000);
    expect(logs.join('\n')).not.toContain(KEY);
    // One recording, unbroken, carrying on after the connection dropped.
    expect(readdirSync(dir).filter((f) => f.endsWith('.mkv'))).toEqual(['recording.mkv']);
    const clusters: MkvCluster[] = [];
    const splitter = new MkvSplitter(
      () => undefined,
      (c) => clusters.push(c),
    );
    splitter.push(readFileSync(join(dir, 'recording.mkv')));
    const secs = clusters.map((c) => (c.timestamp * splitter.timestampScaleNs) / 1e9);
    expect(secs[0]).toBe(0);
    expect(Math.max(...secs.slice(1).map((t, i) => t - (secs[i] ?? 0)))).toBeLessThan(2.1);
    expect(droppedAt).toBeGreaterThan(1);
    expect(secs.at(-1) ?? 0).toBeGreaterThan(droppedAt);
  }, 120_000);

  it('FFmpeg never gets the environment Drashti was started with: FFREPORT set for Drashti writes no report holding the key (Session 28, MED-4)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    // FFREPORT's options are split at ':', so a Windows drive's has to be escaped.
    const report = join(dir, 'ffreport.log')
      .replaceAll('\\', '/')
      .replace(/^([A-Za-z]):/u, '$1\\:');
    const was = process.env['FFREPORT'];
    process.env['FFREPORT'] = `file=${report}:level=32`;
    try {
      const port = await freePort();
      const seen: { live: boolean } = { live: false };
      const watched = new StreamPipeline({
        status: (st) => {
          seen.live ||= st.live.state === 'live';
        },
        log: () => undefined,
      });
      await watched.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
      const { stop } = feed(watched);
      try {
        listener(port, join(dir, 'got.flv'));
        await sleep(500);
        watched.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
        await until('on air', () => seen.live);
        await sleep(1500);
        watched.endLive();
      } finally {
        stop();
        watched.stop();
      }
      await sleep(500);
      expect(statSync(join(dir, 'got.flv')).size).toBeGreaterThan(1000);
      expect(readdirSync(dir).filter((f) => f.startsWith('ffreport'))).toEqual([]);
    } finally {
      if (was === undefined) delete process.env['FFREPORT'];
      else process.env['FFREPORT'] = was;
    }
  }, 60_000);

  it('the key goes to FFmpeg apart from the address (-rtmp_playpath): what FFmpeg itself says never holds it, and the listener gets the stream by it (Session 28, decision 17)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const port = await freePort();
    const said: string[] = [];
    const seen: { state: string } = { state: '' };
    const p = new StreamPipeline({
      status: (st) => {
        seen.state = st.live.state;
      },
      log: () => undefined,
      connectionLine: (line) => said.push(line),
    });
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const { stop } = feed(p);
    let heard = '';
    try {
      // Nothing listening yet: FFmpeg says it cannot connect, naming the address.
      p.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
      await until('a refused connection', () => seen.state === 'reconnecting');
      // Then the listener, which warns of any other stream name than its own (live2/KEY).
      const listening = spawn(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'info',
          '-listen',
          '1',
          '-i',
          `rtmp://127.0.0.1:${port}/live2/${KEY}`,
          '-c',
          'copy',
          '-f',
          'flv',
          '-y',
          join(dir, 'got.flv'),
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], env: withoutReport() },
      );
      children.push(listening);
      listening.stderr.on('data', (d: Buffer) => {
        heard += d.toString();
      });
      await until('on air', () => seen.state === 'live', 40_000);
      await sleep(1500);
      p.endLive();
    } finally {
      stop();
      p.stop();
    }
    // The listener's file, once what it got is written.
    await sleep(1000);
    expect(said.length).toBeGreaterThan(0);
    expect(said.join('\n')).not.toContain(KEY);
    expect(said.join('\n')).toContain(`127.0.0.1:${String(port)}`);
    expect(heard).not.toContain('Unexpected stream');
    expect(statSync(join(dir, 'got.flv')).size).toBeGreaterThan(1000);
  }, 90_000);

  it('records without going live; when the disk runs low the recording stops and says why, and the stream goes on', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const port = await freePort();
    const seen: { status: WorkerStatus | null } = { status: null };
    let free = 100 * 1024 ** 3;
    const p = new StreamPipeline({
      status: (s) => {
        seen.status = s;
      },
      log: () => undefined,
      freeBytes: () => free,
    });
    const current = () => seen.status;
    const KEEP_FREE = 2 * 1024 ** 3;
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const { stop } = feed(p);
    try {
      // Recording alone: nothing goes on air.
      p.record(join(dir, 'alone.mkv'), KEEP_FREE);
      await until('recording', () => (current()?.recording.bytes ?? 0) > 20_000);
      expect(current()?.recording.state).toBe('recording');
      expect(current()?.live.state).toBe('off');
      // Then on air as well, until the disk runs low: the recording stops with a message; the stream goes on.
      listener(port, join(dir, 'live.flv'));
      await sleep(500);
      p.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
      await until('on air', () => current()?.live.state === 'live');
      free = 1.5 * 1024 ** 3;
      await until('the recording stopped', () => current()?.recording.state === 'off');
      expect(current()?.recording.message).toBe(
        'The recording stopped: only 1.5 GB is free on that disk, and Drashti keeps 2 GB free. The stream goes on.',
      );
      await sleep(2000);
      expect(current()?.live.state).toBe('live');
      // A new recording is refused while the disk is that full, and no file is made.
      p.record(join(dir, 'refused.mkv'), KEEP_FREE);
      expect(current()?.recording.state).toBe('off');
      expect(existsSync(join(dir, 'refused.mkv'))).toBe(false);
      p.endLive();
    } finally {
      stop();
      p.stop();
    }
    await sleep(1000);
    // The recording made alone reads from its start, as a player reads it.
    const clusters: MkvCluster[] = [];
    let header = false;
    const splitter = new MkvSplitter(
      () => {
        header = true;
      },
      (c) => clusters.push(c),
    );
    splitter.push(readFileSync(join(dir, 'alone.mkv')));
    expect(header).toBe(true);
    expect(clusters[0]?.startsPicture).toBe(true);
    expect(clusters.at(-1)?.timestamp ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('when the encoder starts again on air, the connection starts again with it: its times never go back', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const port = await freePort();
    const logs: string[] = [];
    const seen: { status: WorkerStatus | null } = { status: null };
    const p = new StreamPipeline({
      status: (s) => {
        seen.status = s;
      },
      log: (_level, line) => {
        logs.push(line);
      },
    });
    const current = () => seen.status;
    // A listener for each connection, one after another (each takes one), until the test is done.
    let listeners = 0;
    let listening = true;
    const listen = (): void => {
      if (!listening) return;
      listeners++;
      const child = listener(port, join(dir, `connection ${String(listeners)}.flv`));
      child.on('exit', () => {
        if (listening && listeners < 3) listen();
      });
    };
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const { stop } = feed(p);
    try {
      listen();
      await sleep(500);
      p.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
      await until('on air', () => current()?.live.state === 'live');
      await sleep(3000);
      // The encoder goes down by itself: a new one starts, and so does the connection.
      (p as unknown as { encodeProcess: ChildProcess | null }).encodeProcess?.kill('SIGKILL');
      await until('the connection started again', () =>
        logs.some((l) => l.includes('The encoder started again, and so does the connection')),
      );
      await until(
        'the second connection sending',
        () =>
          existsSync(join(dir, 'connection 2.flv')) && statSync(join(dir, 'connection 2.flv')).size > 20_000,
      ).catch((error: unknown) => {
        throw new Error(`${String(error)}\n${logs.join('\n')}`);
      });
      expect(current()?.live.state).toBe('live');
      p.endLive();
    } finally {
      listening = false;
      stop();
      p.stop();
    }
    // FFmpeg never saw the times go back (it would say so, and hold every packet's time).
    expect(logs.filter((l) => /non-monotonic/iu.test(l))).toEqual([]);
  }, 120_000);

  it('a recording goes on in a new file only once the encoder is back; going down with it leaves no extra file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const seen: { status: WorkerStatus | null } = { status: null };
    const p = new StreamPipeline({
      status: (s) => {
        seen.status = s;
      },
      log: () => undefined,
    });
    const current = () => seen.status;
    /** The encoder going down by itself, as when the system ends it first. */
    const killEncoder = () => {
      (p as unknown as { encodeProcess: ChildProcess | null }).encodeProcess?.kill('SIGKILL');
    };
    const files = () =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.mkv'))
        .sort();
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    let feeding = feed(p);
    const stop = () => {
      feeding.stop();
    };
    try {
      p.record(join(dir, 'recording.mkv'), 1024 ** 2);
      await until('recording', () => (current()?.recording.bytes ?? 0) > 20_000);
      // The encoder goes down while recording, and no picture comes: no new file however long it waits...
      stop();
      killEncoder();
      await sleep(1500);
      expect(files()).toEqual(['recording.mkv']);
      expect(current()?.recording.state).toBe('recording');
      // ...then pictures come, the encoder is back, and the recording goes on in one new file.
      feeding = feed(p);
      await until('a new part', () => (current()?.recording.file ?? '').includes(' part '));
      await until('the new part grows', () => (current()?.recording.bytes ?? 0) > 20_000);
      expect(files()).toHaveLength(2);
      // Drashti going down, the encoder first: nothing new is made.
      killEncoder();
      stop();
      p.stop();
      await sleep(2500);
      expect(files()).toHaveLength(2);
      expect(current()?.recording.state).toBe('off');
    } finally {
      stop();
      p.stop();
    }
  }, 120_000);

  it('a long recording goes on in parts, each from a picture with its own header, none lost or doubled; names never collide, and the disk keeps it every 10 s at most (Session 31, MED-2)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    // A part left from an earlier recording of the same name: never written over.
    const left = Buffer.from('an earlier recording, kept as it is');
    writeFileSync(join(dir, 'recording part 2.mkv'), left);
    // Every cluster the encoder gives, from the recording's first picture to its stop: what the parts must hold.
    let counting: 'off' | 'waiting' | 'on' = 'off';
    let produced = 0;
    const syncs: number[] = [];
    const p = new StreamPipeline({
      status: () => undefined,
      log: () => undefined,
      cluster: (c) => {
        if (counting === 'waiting' && c.startsPicture) counting = 'on';
        if (counting === 'on') produced++;
      },
      datasync: (fd, done) => {
        syncs.push(Date.now());
        fdatasync(fd, done);
      },
    });
    const parts = () =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.mkv') && f !== 'recording part 2.mkv')
        .sort();
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const feeding = feed(p);
    let startedAt = 0;
    try {
      counting = 'waiting';
      startedAt = Date.now();
      // At most 150 KB to a part (about 1.5 s here): the next part from the next picture after that.
      p.record(join(dir, 'recording.mkv'), 1024 ** 2, 150_000);
      await until('three parts', () => parts().length >= 3, 40_000);
      await until('two flushes', () => syncs.length >= 2, 40_000);
      p.stopRecording();
      counting = 'off';
    } finally {
      feeding.stop();
      p.stop();
    }
    await sleep(1500);
    // The earlier part as it was; the new ones named on from it, never over it.
    expect(readFileSync(join(dir, 'recording part 2.mkv'))).toEqual(left);
    const names = parts();
    expect(names).toContain('recording.mkv');
    expect(names).toContain('recording part 3.mkv');
    expect(names).not.toContain('recording part 2.mkv');
    let total = 0;
    for (const name of names) {
      let header = false;
      const clusters: MkvCluster[] = [];
      const splitter = new MkvSplitter(
        () => {
          header = true;
        },
        (c) => clusters.push(c),
      );
      splitter.push(readFileSync(join(dir, name)));
      expect(header, `${name} has its own header`).toBe(true);
      expect(clusters[0]?.startsPicture, `${name} starts with a picture`).toBe(true);
      expect(clusters[0]?.timestamp, `${name} starts at 0`).toBe(0);
      total += clusters.length;
    }
    expect(produced).toBeGreaterThan(0);
    expect(total).toBe(produced);
    // Kept on the disk about every 10 s, the first within 10 s of starting.
    const gaps = syncs.map((t, i) => t - (i === 0 ? startedAt : (syncs[i - 1] ?? 0)));
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(10_000);
  }, 120_000);

  it('a limiter keeps the sound under -1 dBFS before AAC: full-scale and louder tones read back at -0.5 dBFS at most, and a quiet one as it was (Session 31, MED-3)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-pipeline-'));
    const p = new StreamPipeline({ status: () => undefined, log: () => undefined });
    const loud = { amplitude: 0.2 };
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null, caFile: null });
    const feeding = feed(p, loud);
    const levels: Record<string, { peak: number; rms: number }> = {};
    try {
      // Quietest first: what is left of one tone in the next recording's first moment is quieter still.
      for (const amplitude of [0.2, 1.0, 1.5]) {
        loud.amplitude = amplitude;
        await sleep(1000);
        const file = join(dir, `tone ${String(amplitude)}.mkv`);
        p.record(file, 1024 ** 2);
        await sleep(4000);
        p.stopRecording();
      }
    } finally {
      feeding.stop();
      p.stop();
    }
    await sleep(1500);
    for (const amplitude of [0.2, 1.0, 1.5])
      levels[String(amplitude)] = soundLevels(join(dir, `tone ${String(amplitude)}.mkv`));
    // The quiet tone (0.2: RMS -16.99 dBFS) is untouched: within 0.5 dB.
    expect(Math.abs((levels['0.2']?.rms ?? 0) - 20 * Math.log10(0.2 / Math.SQRT2))).toBeLessThanOrEqual(0.5);
    // Full scale, and louder than full scale (Drashti's own sound and the microphone together can be), never
    // above -0.5 dBFS once AAC has made its own overshoot.
    expect(levels['1']?.peak).toBeLessThanOrEqual(-0.5);
    expect(levels['1.5']?.peak).toBeLessThanOrEqual(-0.5);
  }, 120_000);
});
