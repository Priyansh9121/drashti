import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { STREAM_PRESETS } from '../../../shared/stream';
import { makeAuthority } from '../testing/made-up-ca';
import { StreamPipeline } from './pipeline';
import type { WorkerStatus } from './protocol';

/*
 * Going live over RTMPS (Session 23), with the bundled FFmpeg, against a
 * stand-in on this computer: a TLS server on 127.0.0.1 whose certificate a
 * made-up authority signed, passing what it receives on to FFmpeg listening
 * for plain RTMP. Nothing goes to the internet. FFmpeg checks the server's
 * certificate (it always does: Drashti never turns that off), so it is
 * refused until it is given the authority's file, as it is given the
 * system's own authorities on a Mac.
 */

const vendor = (target: string) =>
  join(process.cwd(), 'vendor', 'ffmpeg', target, target.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg');
/** This computer's own FFmpeg (it also stands in for YouTube). */
const ffmpeg = vendor(`${process.platform}-${process.arch}`);
/**
 * Every bundled FFmpeg this computer can run: its own, and on an Apple-silicon Mac the Intel Mac's
 * under Rosetta when it is there (CI fetches both Mac builds).
 */
const builds = [
  { label: `${process.platform}-${process.arch}`, path: ffmpeg },
  ...(process.platform === 'darwin' &&
  process.arch === 'arm64' &&
  spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0
    ? [{ label: 'darwin-x64 (under Rosetta)', path: vendor('darwin-x64') }]
    : []),
].filter((b) => existsSync(b.path));
const KEY = 'test-made-up-key-rtmps-0000';
const preset = { ...STREAM_PRESETS.weak, width: 320, height: 180, videoKbps: 800 };

let dir = '';
const children: ChildProcess[] = [];
const servers: TlsServer[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const s of servers.splice(0)) s.close();
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

/** FFmpeg waiting for one plain RTMP stream on this port, saving it as FLV. */
function listener(port: number, file: string): void {
  children.push(
    spawn(
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
    ),
  );
}

/** The stand-in's TLS front: what it decrypts goes on to the plain RTMP listener. */
function tlsFront(
  certPem: string,
  keyPem: string,
  rtmpPort: number,
): Promise<{ port: number; handshakes: () => number; refusals: string[] }> {
  let handshakes = 0;
  const refusals: string[] = [];
  const server = createTlsServer({ cert: certPem, key: keyPem }, (socket) => {
    handshakes++;
    const back = connect(rtmpPort, '127.0.0.1');
    socket.pipe(back).pipe(socket);
    socket.on('error', () => back.destroy());
    back.on('error', () => socket.destroy());
  });
  server.on('tlsClientError', (error) => {
    refusals.push(error.message);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ port: typeof a === 'object' && a ? a.port : 0, handshakes: () => handshakes, refusals });
    });
  });
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

/** Go live to the stand-in with this authority file given to FFmpeg (or none), and see what happens. */
async function goLive(build: string, caFile: string | null, want: 'live' | 'refused') {
  const authority = makeAuthority();
  const rtmpPort = await freePort();
  const flv = join(dir, 'received.flv');
  listener(rtmpPort, flv);
  const front = await tlsFront(authority.certPem, authority.keyPem, rtmpPort);
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
  if (caFile === 'authority') {
    caFile = join(dir, 'made-up-authority.pem');
    writeFileSync(caFile, authority.caPem);
  }
  await p.start({ ffmpeg: build, platform: process.platform, preset, encoder: null, caFile });
  const stop = feed(p);
  try {
    p.goLive(`rtmps://127.0.0.1:${front.port}/live2`, KEY);
    await until(
      want === 'live' ? 'on air' : 'the connection refused',
      () => seen.status?.live.state === (want === 'live' ? 'live' : 'reconnecting'),
      40_000,
    ).catch((error: unknown) => {
      throw new Error(`${String(error)}\n${logs.join('\n')}\nTLS refusals: ${front.refusals.join('; ')}`);
    });
    if (want === 'live') await sleep(2000);
    return {
      live: seen.status?.live ?? null,
      handshakes: front.handshakes(),
      refusals: [...front.refusals],
      logs,
      received: () => (existsSync(flv) ? statSync(flv).size : 0),
    };
  } finally {
    p.endLive();
    stop();
    p.stop();
  }
}

describe.skipIf(!existsSync(ffmpeg)).each(builds)('going live over RTMPS with FFmpeg $label', ({ path }) => {
  it('refuses a server whose authority it was not given, and says why in plain words', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-rtmps-'));
    const r = await goLive(path, null, 'refused');
    // OpenSSL (the Mac's FFmpeg) and GnuTLS (Windows') each say it their way.
    expect(r.logs.join('\n')).toMatch(/certificate verify failed|Peer certificate failed verification/u);
    expect(r.live?.message ?? '').toMatch(/^The stream server’s certificate could not be checked/u);
    await sleep(1000);
    expect(r.received()).toBe(0);
    expect(r.logs.join('\n')).not.toContain(KEY);
  }, 120_000);

  it('goes live once given that authority’s file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-rtmps-'));
    const r = await goLive(path, 'authority', 'live');
    expect(r.handshakes).toBeGreaterThanOrEqual(1);
    expect(r.refusals).toEqual([]);
    await until('the stand-in receiving the stream', () => r.received() > 1000, 10_000);
    expect(r.logs.join('\n')).not.toContain(KEY);
  }, 120_000);
});
