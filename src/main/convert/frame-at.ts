import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';

const FRAME_READ_MS = 15_000;

/** Read from the preceding keyframe, then stop as soon as the next displayed frame is known. */
export function frameAtOrBefore(ffmpeg: string, file: string, atMs: number): Promise<number | null> {
  if (atMs <= 0) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-nostats',
        '-nostdin',
        '-protocol_whitelist',
        'file',
        '-copyts',
        '-start_at_zero',
        '-noaccurate_seek',
        '-ss',
        (atMs / 1000).toFixed(3),
        '-i',
        file,
        '-map',
        '0:V:0',
        '-an',
        '-sn',
        '-vf',
        'showinfo',
        '-fps_mode:v',
        'passthrough',
        '-f',
        'null',
        '-',
      ],
      { windowsHide: true, env: ffmpegEnv() },
    );
    try {
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_LOW);
    } catch {
      // Some systems only let the app run it at normal priority.
    }
    let timeBaseMs = 0;
    let previous: number | null = null;
    let partial = '';
    let done = false;
    const finish = (at: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(at);
    };
    const timer = setTimeout(() => finish(null), FRAME_READ_MS);
    child.stderr.on('data', (chunk: Buffer) => {
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.includes('Parsed_showinfo_')) continue;
        const base = /config in time_base:\s*(\d+)\/(\d+)/u.exec(line);
        if (base) timeBaseMs = (1000 * Number(base[1])) / Number(base[2]);
        const frame = /\bn:\s*\d+\s+pts:\s*(-?\d+)/u.exec(line);
        if (!frame || timeBaseMs === 0) continue;
        const at = Math.max(0, Number(frame[1]) * timeBaseMs);
        if (at > atMs + 0.000_001) {
          finish(previous ?? at);
          return;
        }
        previous = at;
      }
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? previous : null));
  });
}
