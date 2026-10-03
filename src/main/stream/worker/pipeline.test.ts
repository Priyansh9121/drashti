import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  if (dir) rmSync(dir, { recursive: true, force: true });
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
    { stdio: 'ignore' },
  );
  children.push(child);
  return child;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** Frames (a grey that changes) and sound, 1/30 s at a time, until stopped. */
function feed(p: StreamPipeline): () => void {
  p.fromProgram({ kind: 'format', width: preset.width, height: preset.height, format: 'I420' });
  let n = 0;
  const timer = setInterval(() => {
    const frame = new Uint8Array((preset.width * preset.height * 3) / 2).fill((n * 7) % 255);
    p.fromProgram({ kind: 'video', data: frame.buffer });
    const audio = new Float32Array(1600 * 2).map(
      (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * (n * 1600 + (i >> 1))) / 48_000),
    );
    p.fromProgram({ kind: 'audio', data: audio.buffer, frames: 1600 });
    n++;
  }, 1000 / 30);
  return () => {
    clearInterval(timer);
  };
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
    await p.start({ ffmpeg, platform: process.platform, preset, encoder: null });
    const stop = feed(p);
    try {
      const first = listener(port, join(dir, 'first.flv'));
      await sleep(500);
      p.record(join(dir, 'recording.mkv'), 1024 ** 2);
      p.goLive(`rtmp://127.0.0.1:${port}/live2`, KEY);
      await until('on air', () => current()?.live.state === 'live');
      await sleep(3000);
      first.kill('SIGKILL');
      await until('reconnecting', () => current()?.live.state === 'reconnecting');
      await sleep(1500);
      listener(port, join(dir, 'second.flv'));
      await until('on air again', () => current()?.live.state === 'live', 40_000).catch((error: unknown) => {
        throw new Error(`${String(error)}\n${logs.join('\n')}`);
      });
      await sleep(3000);
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
    // One recording, unbroken.
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
    expect(secs.at(-1) ?? 0).toBeGreaterThan(8);
  }, 120_000);
});
