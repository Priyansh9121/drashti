import { type ChildProcess, spawn } from 'node:child_process';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { type MediaInfo, parseFfmpegInfo } from './plan';

/*
 * Reading what a file holds with the bundled FFmpeg (`ffmpeg -i`): for a conversion, and (Session 50) for
 * each video and sound at import, in the import worker. A module of its own, so the worker needs nothing
 * of the conversions' service.
 */

/** The longest FFmpeg may take to read what a file holds (Session 31, MED-6). */
export const PROBE_MS = 30_000;

/**
 * What FFmpeg says the file holds (it prints this and stops: there is no output), within `timeoutMs`
 * (30 s): longer, it is stopped and `timedOut` says so. Only files may be opened, and FFmpeg gets the
 * stream's clean environment (Session 31, MED-6). `onSpawn` lets a caller stop it meanwhile.
 */
export function readInfo(
  ffmpeg: string,
  file: string,
  options: { timeoutMs?: number; onSpawn?(child: ChildProcess): void } = {},
): Promise<MediaInfo & { timedOut?: true }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-protocol_whitelist', 'file', '-i', file], {
      windowsHide: true,
      env: ffmpegEnv(),
    });
    options.onSpawn?.(child);
    let text = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? PROBE_MS);
    child.stderr.on('data', (d: Buffer) => (text += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(parseFfmpegInfo(''));
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(timedOut ? { ...parseFfmpegInfo(''), timedOut: true } : parseFfmpegInfo(text));
    });
  });
}
