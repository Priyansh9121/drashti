import { spawn } from 'node:child_process';
import type { StreamPreset } from '../../../shared/stream';

/*
 * H.264 encoders, best first: the computer's hardware where it has one that
 * works (VideoToolbox on a Mac; NVIDIA NVENC, Intel Quick Sync or AMD AMF on
 * Windows), x264 in software otherwise. Which one works is found with a
 * short test encode, once, and shown to the operator.
 *
 * Every encoder is asked for the same: constant bitrate at the preset's
 * rate, a keyframe every 2 seconds exactly, 4:2:0 colour, no frame later
 * than it must be.
 */

export interface EncoderChoice {
  /** FFmpeg's name for it. */
  name: string;
  /** What the operator is shown. */
  label: string;
  hardware: boolean;
}

const MAC: EncoderChoice[] = [
  { name: 'h264_videotoolbox', label: 'VideoToolbox (hardware)', hardware: true },
  { name: 'libx264', label: 'x264 (software)', hardware: false },
];
const WINDOWS: EncoderChoice[] = [
  { name: 'h264_nvenc', label: 'NVIDIA NVENC (hardware)', hardware: true },
  { name: 'h264_qsv', label: 'Intel Quick Sync (hardware)', hardware: true },
  { name: 'h264_amf', label: 'AMD AMF (hardware)', hardware: true },
  { name: 'libx264', label: 'x264 (software)', hardware: false },
];

export function encoderCandidates(platform: NodeJS.Platform): EncoderChoice[] {
  if (platform === 'darwin') return MAC;
  if (platform === 'win32') return WINDOWS;
  return [{ name: 'libx264', label: 'x264 (software)', hardware: false }];
}

/** The video encoder's own options, for constant bitrate and low delay. */
function ownOptions(encoder: string, kbps: number): string[] {
  switch (encoder) {
    case 'h264_videotoolbox':
      return ['-realtime', '1', '-prio_speed', '1', '-profile:v', 'high', '-constant_bit_rate', '1'];
    case 'h264_nvenc':
      return ['-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-profile:v', 'high', '-bf', '2'];
    case 'h264_qsv':
      return ['-preset', 'veryfast', '-profile:v', 'high', '-look_ahead', '0'];
    case 'h264_amf':
      return ['-usage', 'lowlatency', '-rc', 'cbr', '-quality', 'speed', '-profile:v', 'high'];
    default:
      // x264: fast enough on modest computers, with a strict buffer (constant bitrate).
      return [
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'high',
        '-x264-params',
        `nal-hrd=cbr:force-cfr=1:vbv-maxrate=${kbps}:vbv-bufsize=${kbps}`,
      ];
  }
}

/** The video encoder's arguments for a preset. */
export function videoArgs(encoder: string, preset: StreamPreset): string[] {
  const kbps = preset.videoKbps;
  const gop = preset.fps * preset.keyframeSeconds;
  return [
    '-c:v',
    encoder,
    ...ownOptions(encoder, kbps),
    '-b:v',
    `${kbps}k`,
    '-minrate',
    `${kbps}k`,
    '-maxrate',
    `${kbps}k`,
    '-bufsize',
    `${kbps}k`,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-force_key_frames',
    `expr:gte(t,n_forced*${preset.keyframeSeconds})`,
    '-pix_fmt',
    encoder === 'h264_qsv' ? 'nv12' : 'yuv420p',
    '-r',
    String(preset.fps),
    '-fps_mode',
    'cfr',
  ];
}

/** AAC at the preset's rate, 48 kHz stereo. */
export function audioArgs(preset: StreamPreset): string[] {
  return ['-c:a', 'aac', '-b:a', `${preset.audioKbps}k`, '-ar', String(preset.sampleRate), '-ac', '2'];
}

/** Whether this encoder works here: a second of a test picture, encoded and thrown away. */
export function tryEncoder(
  ffmpeg: string,
  encoder: string,
  preset: StreamPreset,
  timeoutMs = 15_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${preset.width}x${preset.height}:rate=${preset.fps}`,
        '-t',
        '1',
        ...videoArgs(encoder, preset),
        '-f',
        'null',
        '-',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** The first encoder that works here, in order of preference. */
export async function pickEncoder(
  ffmpeg: string,
  platform: NodeJS.Platform,
  preset: StreamPreset,
  only?: string,
): Promise<EncoderChoice | null> {
  const candidates = encoderCandidates(platform).filter((c) => !only || c.name === only);
  for (const c of candidates) if (await tryEncoder(ffmpeg, c.name, preset)) return c;
  return null;
}
