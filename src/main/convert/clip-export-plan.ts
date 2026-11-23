import { hasAlpha, type MediaInfo } from './plan';
export interface ClipPlan {
  source: string;
  startMs: number;
  endMs: number;
  shape: 'source' | 'vertical';
  info: MediaInfo;
  alpha?: boolean;
  audioTrack?: number | null;
  container?: 'mp4' | 'webm';
}
const seconds = (value: number) => (value / 1000).toFixed(3);

/** Accurate input seeking decodes from the preceding keyframe; no stream-copy keyframe substitution. */
export function clipExportArgs(input: ClipPlan, dest: string): string[] {
  const { info, startMs, endMs, source } = input;
  if (
    !info.video ||
    !info.durationMs ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > info.durationMs
  )
    throw new Error('Choose a start and end inside this video, with the end after the start.');
  if (
    input.audioTrack !== undefined &&
    input.audioTrack !== null &&
    (!Number.isInteger(input.audioTrack) || input.audioTrack < 0 || input.audioTrack > 255)
  )
    throw new Error('Choose one of this video’s sound tracks.');
  const alpha = input.alpha === true || hasAlpha(info);
  if (alpha && input.container === 'mp4') throw new Error('Choose WebM to keep this video’s transparency.');
  const webm = alpha || input.container === 'webm';
  const decoder =
    alpha && info.video.codec === 'vp9'
      ? ['-c:V:0', 'libvpx-vp9']
      : alpha && info.video.codec === 'vp8'
        ? ['-c:V:0', 'libvpx']
        : [];
  const sound = info.audio && input.audioTrack !== null;
  const normalize = "scale=w='trunc(iw*if(gt(sar,0),sar,1)/2)*2':h=trunc(ih/2)*2,setsar=1";
  const vertical =
    input.shape === 'vertical'
      ? ',scale=1080:1920:force_original_aspect_ratio=increase:flags=bicubic,crop=1920*9/16:1920,setsar=1'
      : '';
  const filter = `${info.video.interlaced ? 'bwdif=mode=send_frame:deint=interlaced,' : ''}${normalize}${vertical},format=${alpha ? 'yuva420p' : 'yuv420p'}`;
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:2',
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-protocol_whitelist',
    'file',
    ...decoder,
    '-ss',
    seconds(startMs),
    '-i',
    source,
    '-t',
    seconds(endMs - startMs),
    '-map',
    '0:V:0',
    ...(sound ? ['-map', `0:a:${String(input.audioTrack ?? 0)}`] : []),
    '-sn',
    '-dn',
    '-vf',
    filter,
    ...(webm
      ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-auto-alt-ref', '0']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart']),
    ...(sound ? ['-c:a', webm ? 'libopus' : 'aac', '-b:a', '192k'] : ['-an']),
    '-pix_fmt',
    alpha ? 'yuva420p' : 'yuv420p',
    '-threads',
    '1',
    '-fps_mode',
    'passthrough',
    '-map_metadata',
    '0',
    '-metadata:s:v:0',
    'rotate=0',
    '-f',
    webm ? 'webm' : 'mp4',
    dest,
  ];
}
