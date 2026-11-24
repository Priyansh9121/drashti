import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { sha256File } from '../import/media-store';
import { ffmpegEnv } from '../stream/worker/ffmpeg-env';
import { testFfmpeg } from '../testing/ffmpeg-here';
import { ConvertService } from './convert-service';
import { readTrimInfo } from './trim-copy';

export const copyFfmpeg = testFfmpeg({ linux: true });
export function copyFf(args: string[]): Buffer {
  const made = spawnSync(
    copyFfmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      ...args,
    ],
    { env: ffmpegEnv() },
  );
  if (made.status !== 0) throw new Error('The bundled FFmpeg could not make the generated copy fixture.');
  return made.stdout;
}
export async function copyFixture(
  options: {
    large?: boolean;
    alpha?: boolean;
    /** The save gate as the app gives it (alpha.22, shared/save-waits.ts): why a save the operator asked for waits. */
    saveBusy?: () => string | null;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-copy-'));
  const name = options.alpha ? 'placeholder.webm' : 'placeholder.mp4';
  const source = join(dir, name);
  const size = options.large ? '3840x2160' : '160x90';
  const duration = options.large || options.alpha ? '0.4' : '2';
  const picture = options.alpha
    ? `color=0x336699@0.5:s=${size}:r=25:d=${duration},format=yuva420p`
    : `color=black:s=${size}:r=25:d=${duration}${options.large ? '' : ",geq=lum='24+N*4':cb=128:cr=128"}`;
  copyFf([
    '-f',
    'lavfi',
    '-i',
    picture,
    ...(options.alpha
      ? ['-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '250', '-pix_fmt', 'yuv420p']),
    '-threads',
    '1',
    source,
  ]);
  const hashed = await sha256File(source);
  const info = await readTrimInfo(copyFfmpeg, source);
  const db = openDatabase(join(dir, 'library.sqlite'));
  db.prepare(
    "INSERT INTO media(id,kind,name,path,sha256,bytes,duration_ms,playable) VALUES ('source','video','Placeholder source',?,?,?,?,1)",
  ).run(name, hashed.sha256, hashed.bytes, info.durationMs);
  const media = new MediaRepo(db);
  const activity = { show: false, stream: false, recording: false };
  const idle = () => !activity.show && !activity.stream && !activity.recording;
  const active = new Set<number>();
  let maximum = 0;
  const conversions = new ConvertService({
    db,
    mediaDir: dir,
    ffmpegPath: () => copyFfmpeg,
    busy: () => (activity.stream || activity.recording ? 'Waits while the stream or recording is on.' : null),
    showBusy: () => activity.show,
    ...(options.saveBusy ? { saveBusy: options.saveBusy } : {}),
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
    children: {
      started: (pid) => {
        if (pid !== undefined) active.add(pid);
        maximum = Math.max(maximum, active.size);
      },
      ended: (pid) => {
        if (pid !== undefined) active.delete(pid);
      },
    },
  });
  return {
    dir,
    source,
    db,
    media,
    info,
    activity,
    idle,
    conversions,
    sha: hashed.sha256,
    maxActive: () => maximum,
    cleanup: () => {
      conversions.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
