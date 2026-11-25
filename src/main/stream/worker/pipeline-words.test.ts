import type * as ChildProcesses from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import { type ExitFirstChild, exitFirstChild } from '../../testing/exit-first-child';
import { StreamPipeline } from './pipeline';
import type { WorkerLive } from './protocol';

/*
 * Why a connection stopped, said from what its FFmpeg said last (a22-exitreaders, after x58), when its exit is told
 * before those last words are read, as a busy computer may: each FFmpeg here is a stand-in that ends that way
 * (testing/exit-first-child.ts). And the waits that keep a live stream safe: one reconnect only, none once the stream
 * is ended or stopped, none for a program that never started. Nothing is started and nothing goes anywhere; a made-up
 * key.
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
/** The pipeline's log line for each reconnect it plans. */
const TRYING_AGAIN = 'Trying again in';

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
const turn = () => new Promise((r) => setImmediate(r));

async function until(what: string, check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

interface Live {
  pipeline: StreamPipeline;
  live: () => WorkerLive | null;
  logs: string[];
}

/** A pipeline gone live to `url` whose every FFmpeg is a stand-in, and what it says of the place. */
async function goLive(url: string): Promise<Live> {
  spawn.mockImplementation(() => {
    const child = exitFirstChild();
    pushers.push(child);
    return child;
  });
  const seen: { live: WorkerLive | null } = { live: null };
  const logs: string[] = [];
  const p = new StreamPipeline({
    status: (s) => {
      seen.live = s.live;
    },
    log: (_level, line) => {
      logs.push(line);
    },
  });
  pipeline = p;
  // Its encoder named, so none is tried; with no pictures yet, none is started: the one FFmpeg is the connection's.
  await p.start({
    ffmpeg: 'placeholder-ffmpeg',
    platform: process.platform,
    preset,
    encoder: 'libx264',
    caFile: null,
  });
  p.goLive(url, KEY);
  expect(pushers).toHaveLength(1);
  return { pipeline: p, live: () => seen.live, logs };
}

const closed = (child: ExitFirstChild) => new Promise((r) => child.once('close', r));

describe('why a connection stopped, when its FFmpeg’s exit is told before its last words are read', () => {
  it('says the server’s certificate could not be checked, from what FFmpeg said last, as soon as all is read', async () => {
    const { live } = await goLive('rtmps://127.0.0.1:1935/live2');
    const pusher = pushers[0];
    if (!pusher) throw new Error('no connection');
    const all = closed(pusher);
    pusher.end(1, { stderr: CERTIFICATE });
    // At its 'close' (not the 2 s cap): reconnecting the moment all it said has been read.
    await all;
    await turn();
    expect(live()?.state).toBe('reconnecting');
    expect(live()?.message ?? '').toMatch(/^The stream server’s certificate could not be checked/u);
  });

  it('says so even when something still holds its output open: at most 2 s after its exit, with what it said', async () => {
    const { live } = await goLive('rtmp://127.0.0.1:1935/live2');
    pushers[0]?.end(1, { stderr: REFUSED }, true);
    await until('reconnecting', () => live()?.state === 'reconnecting');
    expect(live()?.message ?? '').toMatch(/^YouTube refused the connection\./u);
  });

  it('reconnects once only: the held output ending after the 2 s reconnect plans no second one', async () => {
    const { live, logs } = await goLive('rtmp://127.0.0.1:1935/live2');
    const pusher = pushers[0];
    if (!pusher) throw new Error('no connection');
    pusher.end(1, { stderr: REFUSED }, true);
    await until('reconnecting', () => live()?.state === 'reconnecting');
    const all = closed(pusher);
    pusher.letGo();
    await all;
    // The retry comes 1 s after the reconnect: one new FFmpeg, and no other.
    await until('the retry', () => spawn.mock.calls.length >= 2);
    await sleep(1500);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(live()?.reconnects).toBe(1);
    expect(logs.filter((l) => l.includes(TRYING_AGAIN))).toHaveLength(1);
  });

  it.each(['endLive', 'stop'] as const)(
    'plans no reconnect when the stream is ended (%s) while it waits for FFmpeg’s last words',
    async (how) => {
      const { pipeline: p, live, logs } = await goLive('rtmp://127.0.0.1:1935/live2');
      pushers[0]?.end(1, { stderr: REFUSED }, true);
      if (how === 'endLive') p.endLive();
      else p.stop();
      // Past the 2 s cap, and the 1 s retry it would have planned.
      await sleep(3500);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(logs.filter((l) => l.includes(TRYING_AGAIN))).toEqual([]);
      expect(live()?.state).toBe('off');
    },
  );

  it('a program that never started (an error, then its close, and no exit) gets no reconnect from its close', async () => {
    // Today's behaviour, kept: such a connection is not tried again from here (a22-review-exitreaders nit-4 lists
    // a start that fails at a retry as its own item).
    const { live, logs } = await goLive('rtmp://127.0.0.1:1935/live2');
    pushers[0]?.failToStart();
    // Past the 2 s cap, and the 1 s retry it would have planned.
    await sleep(3500);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(logs.filter((l) => l.includes(TRYING_AGAIN))).toEqual([]);
    expect(live()?.reconnects).toBe(0);
  });
});
