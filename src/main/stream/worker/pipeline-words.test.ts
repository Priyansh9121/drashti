import type * as ChildProcesses from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import { type ExitFirstChild, exitFirstChild } from '../../testing/exit-first-child';
import { StreamPipeline } from './pipeline';
import type { WorkerLive } from './protocol';

/*
 * Why a connection stopped, said from what its FFmpeg said last (a22-exitreaders, after x58), when its exit is told
 * before those last words are read, as a busy computer may: each FFmpeg here is a stand-in that ends that way
 * (testing/exit-first-child.ts). Nothing is started and nothing goes anywhere; a made-up key.
 */

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcesses>();
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const KEY = 'test-made-up-key-pipeline-words-0000';
const preset = { ...STREAM_PRESETS.weak, width: 320, height: 180, videoKbps: 800 };
/** What FFmpeg says when the server's certificate cannot be checked (OpenSSL's words), then why it stopped. */
const CERTIFICATE = [
  '[tls @ 0x0] error:0A000086:SSL routines::certificate verify failed',
  '[out#0/flv @ 0x0] Error opening output rtmps://127.0.0.1:1935/live2: Input/output error',
  '',
].join('\n');
const REFUSED = [
  '[tcp @ 0x0] Connection to tcp://127.0.0.1:1935 failed: Connection refused',
  '[out#0/flv @ 0x0] Error opening output rtmp://127.0.0.1:1935/live2: Connection refused',
  '',
].join('\n');

let pipeline: StreamPipeline | null = null;
const pushers: ExitFirstChild[] = [];
afterEach(() => {
  pipeline?.stop();
  pipeline = null;
  for (const p of pushers.splice(0)) {
    p.stdout.destroy();
    p.stderr.destroy();
  }
  spawn.mockReset();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** A pipeline gone live to `url` whose every FFmpeg is a stand-in, and what it says of the place. */
async function goLive(url: string): Promise<{ live: () => WorkerLive | null }> {
  spawn.mockImplementation(() => {
    const child = exitFirstChild();
    pushers.push(child);
    return child;
  });
  const seen: { live: WorkerLive | null } = { live: null };
  pipeline = new StreamPipeline({
    status: (s) => {
      seen.live = s.live;
    },
    log: () => undefined,
  });
  // Its encoder named, so none is tried; with no pictures yet, none is started: the one FFmpeg is the connection's.
  await pipeline.start({
    ffmpeg: 'placeholder-ffmpeg',
    platform: process.platform,
    preset,
    encoder: 'libx264',
    caFile: null,
  });
  pipeline.goLive(url, KEY);
  expect(pushers).toHaveLength(1);
  return { live: () => seen.live };
}

describe('why a connection stopped, when its FFmpeg’s exit is told before its last words are read', () => {
  it('says the server’s certificate could not be checked, from what FFmpeg said last', async () => {
    const { live } = await goLive('rtmps://127.0.0.1:1935/live2');
    pushers[0]?.end(1, { stderr: CERTIFICATE });
    await until('reconnecting', () => live()?.state === 'reconnecting');
    expect(live()?.message ?? '').toMatch(/^The stream server’s certificate could not be checked/u);
  });

  it('says so even when something still holds its output open: at most 2 s after its exit, with what it said', async () => {
    const { live } = await goLive('rtmp://127.0.0.1:1935/live2');
    pushers[0]?.end(1, { stderr: REFUSED }, true);
    await until('reconnecting', () => live()?.state === 'reconnecting');
    expect(live()?.message ?? '').toMatch(/^YouTube refused the connection\./u);
  });
});
