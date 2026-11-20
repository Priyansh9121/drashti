import { type ChildProcess, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import type { Page } from '@playwright/test';
import { testFfmpeg } from './stream-helpers';

/*
 * A live stream for the stream link's tests (alpha.20, the playback set's slice 8), on this computer only: FFmpeg makes
 * it as the test runs (a moving test picture whose top strip carries the frame's number in 16 blocks, black or white,
 * and a 440 Hz tone; 1 s segments, the newest six listed) and a server on 127.0.0.1 serves it. Never the internet,
 * never real media. `drop()` stops it as a link dropping would (no new segments, the server answering 503); `back()`
 * starts it again afresh (its own numbering and time, as an encoder started again).
 */

const ffmpeg = testFfmpeg() ?? '';

const TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

export interface LiveStandIn {
  /** Its playlist's address (http://127.0.0.1:<port>/live.m3u8). */
  url: string;
  /** Whether its playlist lists a few segments yet. */
  ready(): boolean;
  drop(): void;
  back(): void;
  close(): Promise<void>;
}

/** The stand-in's FFmpeg: in real time, the frame number in the top strip, a tone. */
function writer(dir: string): ChildProcess {
  return spawn(
    ffmpeg,
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-re'],
      ...['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=f=440:r=48000'],
      '-filter_complex',
      "nullsrc=s=16x1:r=30,format=gray,geq=lum='255*gt(bitand(N,pow(2,X)),0)',scale=640:40:flags=neighbor,format=yuv420p[bits];[0:v][bits]overlay=0:0:shortest=1[v]",
      ...['-map', '[v]', '-map', '1:a'],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'baseline'],
      ...['-level', '3.0', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0'],
      ...['-c:a', 'aac', '-b:a', '96k'],
      ...['-f', 'hls', '-hls_time', '1', '-hls_list_size', '6'],
      ...['-hls_flags', 'delete_segments+independent_segments+omit_endlist'],
      ...['-hls_segment_filename', join(dir, 'live-%05d.ts'), join(dir, 'live.m3u8')],
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
}

export async function liveStandIn(): Promise<LiveStandIn> {
  if (ffmpeg === '') throw new Error('FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');
  const root = mkdtempSync(join(tmpdir(), 'drashti-live-stand-in-'));
  let generation = 0;
  let dir = join(root, String(generation));
  mkdirSync(dir);
  let child: ChildProcess | null = writer(dir);
  let down = false;
  const server: Server = createServer((req, res) => {
    if (down) {
      res.writeHead(503, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = normalize(join(dir, path));
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  return {
    url: `http://127.0.0.1:${String(port)}/live.m3u8`,
    // Its playlist lists three segments or more (each is deleted a few seconds after it leaves the list, so never one
    // segment's file: a start slower than that found it gone, CI's Mac, x54-1120-191041-45603).
    ready: () => {
      const file = join(dir, 'live.m3u8');
      if (!existsSync(file)) return false;
      return (
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim().endsWith('.ts')).length >= 3
      );
    },
    drop: () => {
      down = true;
      child?.kill();
      child = null;
    },
    back: () => {
      generation++;
      dir = join(root, String(generation));
      mkdirSync(dir);
      child = writer(dir);
      down = false;
    },
    close: async () => {
      child?.kill();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Windows may hold a killed FFmpeg's folder a moment: the run's own folder takes it.
      }
    },
  };
}

/**
 * What a page shows of the stream link now: the frame number in its top strip, and how bright the rest is; and, to say
 * why when a test fails, each of its players' join and clock (render/live-playback.ts) and media state.
 */
export interface LinkLook {
  state: string | null;
  frame: number | null;
  luma: number | null;
  players: string;
}

/**
 * Read the stream link a page shows (its player shown: the one over the others), from its picture: an output's, or in the
 * operator window LIVE's (`within`: the element it is drawn in), never another small picture of the screens.
 */
export function linkLook(page: Page, within: string | null = null): Promise<LinkLook> {
  return page.evaluate((scope) => {
    const root = scope === null ? document : document.querySelector(scope);
    const box = root?.querySelector('[data-kind="link"]');
    const state = `${box?.getAttribute('data-link-state') ?? 'none'} joins ${box?.getAttribute('data-link-joins') ?? '-'} last error ${box?.getAttribute('data-link-error') ?? '-'} (${box?.getAttribute('data-link-error-words') ?? ''})`;
    const all = [...(box?.querySelectorAll('video') ?? [])];
    const players = all
      .map(
        (v) =>
          `[shown ${v.dataset['shown'] ?? '0'} played ${v.dataset['played'] ? String(Number(v.dataset['played']) - Date.now()) : '-'} moved ${v.dataset['moved'] ?? '-'} seg ${v.dataset['segment'] ?? '-'} startAt-now ${
            v.dataset['startAt'] ? String(Number(v.dataset['startAt']) - Date.now()) : '-'
          } offset ${v.dataset['offset'] ?? '-'} events ${v.dataset['events'] ?? '-'} t ${v.currentTime.toFixed(2)} paused ${String(v.paused)} rs ${String(
            v.readyState,
          )} rate ${String(v.playbackRate)} w ${String(v.videoWidth)} err ${v.error ? String(v.error.code) : '-'}]`,
      )
      .join(' ');
    const video = all.find((v) => v.dataset['shown'] === '1');
    if (!video || video.videoWidth === 0) return { state, frame: null, luma: null, players };
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return { state, frame: null, luma: null, players };
    g.drawImage(video, 0, 0, 640, 360);
    const strip = g.getImageData(0, 0, 640, 40).data;
    let frame = 0;
    for (let i = 0; i < 16; i++) if ((strip[(20 * 640 + 40 * i + 20) * 4] ?? 0) > 128) frame |= 1 << i;
    const body = g.getImageData(0, 60, 640, 300).data;
    let sum = 0;
    for (let i = 0; i < body.length; i += 16)
      sum += ((body[i] ?? 0) + (body[i + 1] ?? 0) + (body[i + 2] ?? 0)) / 3;
    return { state, frame, luma: Math.round(sum / (body.length / 16)), players };
  }, within);
}
