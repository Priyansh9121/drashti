import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { safeName } from '../links/names';
import type { ConvertService, CopyOptions } from './convert-service';
import { convertArgs, hasAlpha, TARGET_EXT } from './plan';
import type { MediaInfo } from './plan';
import { readInfo } from './read-info';

export interface TrimCopyInput {
  path: string;
  name: string;
  info: MediaInfo;
  /** Known transparency when a WebM's native decoder reports only the colour planes. */
  alpha?: boolean;
  startMs: number;
  endMs: number;
  progress?: (fraction: number | null) => void;
  waiting?: (note: string | null) => void;
}

type VideoTarget = 'mp4' | 'webm-alpha';

const seconds = (ms: number): string => (ms / 1000).toFixed(Number.isInteger(ms) ? 3 : 6);

function trimCopyArgs(input: TrimCopyInput, target: VideoTarget, output: string, id: string): string[] {
  // Re-encode even if a whole-file conversion could copy the picture. Accurate input seeking
  // decodes from the preceding keyframe and drops frames before the requested time.
  const args = convertArgs(target, input.path, output, { ...input.info, container: null });
  const inputAt = args.indexOf('-i');
  const codec = input.info.video?.codec;
  const decoder = codec === 'vp8' ? 'libvpx' : codec === 'vp9' ? 'libvpx-vp9' : null;
  // VP8 and VP9's native decoders omit the separate WebM alpha plane.
  const alphaDecoder = target === 'webm-alpha' && decoder ? ['-c:V:0', decoder] : [];
  const encoding = args.slice(inputAt + 2, -1);
  encoding[encoding.indexOf('0:v:0')] = '0:V:0';
  if (target === 'mp4') encoding[encoding.indexOf('+faststart')] = '+faststart+use_metadata_tags';
  return [
    ...args.slice(0, inputAt),
    '-nostdin',
    ...alphaDecoder,
    '-ss',
    // FFmpeg accepts microseconds. Round toward the frame instead of skipping it by a fraction.
    seconds(Math.floor(input.startMs * 1000) / 1000),
    '-i',
    input.path,
    '-t',
    seconds(input.endMs - input.startMs),
    ...encoding,
    // Two cuts can have identical frames but different markers or source times. Keep each as its own library file.
    '-metadata',
    `drashti_trim_id=${id}`,
    // Keep the source frame timestamps, including for variable frame rates.
    '-fps_mode:v',
    'passthrough',
    '-enc_time_base:v',
    'demux',
    '-f',
    TARGET_EXT[target],
    output,
  ];
}

/** Queue a frame-exact part beside the managed original, with the same safeguards as conversion. */
export function queueTrimCopy(conversions: Pick<ConvertService, 'saveCopy'>, input: TrimCopyInput) {
  const target = input.alpha === true || hasAlpha(input.info) ? 'webm-alpha' : 'mp4';
  const name = safeName(input.name, 'Video');
  const dest = join(dirname(input.path), `${basename(name, extname(name))} trimmed.${TARGET_EXT[target]}`);
  const id = randomUUID();
  const copy: CopyOptions = {
    args: (tmp) => trimCopyArgs(input, target, tmp, id),
    lengthMs: input.endMs - input.startMs,
    waitForShow: true,
    progress: input.progress,
    waiting: input.waiting,
  };
  return conversions.saveCopy(input.path, dest, input.info, copy);
}

/** FFmpeg's native VP8 and VP9 decoders report alpha separately from their pixel format. */
export async function readTrimInfo(ffmpeg: string, file: string): Promise<MediaInfo> {
  let tail = '';
  const alpha = { detected: false };
  const info = await readInfo(ffmpeg, file, {
    onSpawn: (child) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        if (alpha.detected) return;
        const text = tail + chunk.toString();
        alpha.detected = /^\s*alpha_mode[ \t]*:[ \t]*1\s*$/imu.test(text);
        tail = text.slice(-100);
      });
    },
  });
  return alpha.detected && info.video && /^vp[89]$/u.test(info.video.codec)
    ? { ...info, video: { ...info.video, pixFmt: 'yuva420p' } }
    : info;
}
