import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { constants, setPriority, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { type PlayingRef, playingOf } from '../../shared/engine/playing';
import type { EngineState } from '../../shared/engine/state';
import { playbackAtMs } from '../../shared/media';
import type { SnapshotResult } from '../../shared/snapshot';
import { frameAtOrBefore } from '../convert/frame-at';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';

/*
 * Snapshot (alpha.20: the owner's Q60-34 items, his "Yes, all A" to Q60-39 P6 (d) A; the time bar's ⋯): the frame on
 * the screens now, full size, made from the video's own file by the bundled FFmpeg below normal priority with one
 * thread (nothing on the screens is read or touched), brought into Media as a PNG named "<video> at 12m34s" through the
 * import as any picture is (never put up). Main reads what plays and where from the engine's state, never the page.
 */

const WRITE_MS = 30_000;

export interface SnapshotDeps {
  /** The engine's state now, and its clock. */
  state(): EngineState;
  now(): number;
  /** A video's file in the library (null: none, or missing) and its name. */
  file(mediaId: string): { path: string; name: string } | null;
  /** The bundled FFmpeg (null: not there). */
  ffmpeg(): string | null;
  /** Brings a made picture into Media, as an import does: its library id, or why not. */
  importFile(path: string): Promise<{ ok: true; mediaId: string } | { ok: false; message: string }>;
  /** Stand-ins for tests: the frame shown at a point, and one frame written as a PNG. */
  frameAt?: (ffmpeg: string, file: string, atMs: number) => Promise<number | null>;
  writeFrame?: (ffmpeg: string, file: string, atMs: number, out: string) => Promise<boolean>;
}

/** The picture's name: "Placeholder talk at 12m34s.png", "… at 1h02m03s.png" from an hour on. */
export function snapshotName(video: string, atMs: number): string {
  const base = basename(video, extname(video));
  const whole = Math.max(0, Math.floor(atMs / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const place = h > 0 ? `${String(h)}h${two(m)}m` : `${String(m)}m`;
  return `${base} at ${place}${two(whole % 60)}s.png`;
}

export async function takeSnapshot(deps: SnapshotDeps, ref: PlayingRef): Promise<SnapshotResult> {
  const playing = playingOf(deps.state(), ref);
  if (!playing)
    return { ok: false, message: 'That video is not playing any more: put it up, then take its snapshot.' };
  if (ref.layer === 'audio' || playing.sound === true)
    return { ok: false, message: 'A snapshot is of a video: use it on a video that is playing.' };
  const length = playing.durationMs;
  if (length === undefined)
    return {
      ok: false,
      message: 'Its length is not known yet: try again in a moment, once it has started playing.',
    };
  const file = deps.file(playing.mediaId);
  if (!file)
    return { ok: false, message: 'Its file is missing, so there is nothing to make a snapshot from.' };
  const ffmpeg = deps.ffmpeg();
  if (!ffmpeg)
    return {
      ok: false,
      message: 'Drashti’s own FFmpeg is missing, so it cannot make a snapshot: install Drashti again.',
    };
  const atMs = playbackAtMs(playing.clock, length, deps.now());
  // The frame the screens show there: the one that starts at or before it.
  const frameMs = (await (deps.frameAt ?? frameAtOrBefore)(ffmpeg, file.path, atMs)) ?? atMs;
  const dir = await mkdtemp(join(tmpdir(), 'drashti-snapshot-'));
  try {
    const name = snapshotName(file.name, atMs);
    const out = join(dir, name);
    if (!(await (deps.writeFrame ?? writeFrame)(ffmpeg, file.path, frameMs, out)))
      return {
        ok: false,
        message:
          'Drashti could not make the snapshot from its file. Try again; if it fails again, choose Help, then Save Diagnostics.',
      };
    const added = await deps.importFile(out);
    return added.ok ? { ok: true, mediaId: added.mediaId, name } : added;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * One frame of a video, full size, as a PNG: the first frame from `atMs` (a frame's own start, so that frame), FFmpeg
 * below normal priority with one thread, given 30 s at most.
 */
export function writeFrame(ffmpeg: string, file: string, atMs: number, out: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file', '-threads', '1'],
        ...['-ss', (Math.floor(Math.max(0, atMs)) / 1000).toFixed(3), '-i', file],
        ...['-map', '0:V:0', '-frames:v', '1', '-y', out],
      ],
      { windowsHide: true, env: ffmpegEnv() },
    );
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Some systems only let the app run it at normal priority.
    }
    const timer = setTimeout(() => child.kill(), WRITE_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
