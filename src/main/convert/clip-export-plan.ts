import { clipPartsInOrder, type ClipPart } from '../../shared/clip-parts';
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
  /**
   * Two or more parts of the one source joined into one clip, in time order (alpha.24, shared/clip-parts.ts): startMs
   * is the first one's start, endMs the last one's end. One part (or none) is the single clip, argument for argument.
   */
  parts?: readonly ClipPart[];
}
const seconds = (value: number) => (value / 1000).toFixed(3);

/** Accurate input seeking decodes from the preceding keyframe; no stream-copy keyframe substitution. */
export function clipExportArgs(input: ClipPlan, dest: string): string[] {
  const { info, startMs, endMs, source } = input;
  const parts = input.parts && input.parts.length >= 2 ? input.parts : null;
  if (
    parts &&
    (!clipPartsInOrder(parts) ||
      parts[0]?.startMs !== startMs ||
      parts[parts.length - 1]?.endMs !== endMs ||
      parts.some((part) => part.startMs < 0 || (info.durationMs !== null && part.endMs > info.durationMs)))
  )
    throw new Error('Choose parts inside this video, each ending before the next one starts.');
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
  if (parts)
    return joinedArgs({ ...input, parts }, { decoder, sound: sound === true, filter, webm, alpha }, dest);
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

/** What the one clip and a joined clip share: the picture's decoder, filter and format, and whether sound goes. */
interface ClipCodecs {
  decoder: string[];
  sound: boolean;
  filter: string;
  webm: boolean;
  alpha: boolean;
}

/**
 * Parts of one video joined into one clip (alpha.24; the owner, 27 Nov 2026: "one video can be cut in 2 parts and
 * merged, for example a 30 minute video, i want from 0 to 10 and 20 to 30 but in 1 video"). The one chosen file is
 * opened once per part, at the part's start, with the single clip's accurate seeking (-ss and -t on the input are
 * FFmpeg's own trim and atrim: frame-exact, and nothing before a part is decoded) and with files only, as Combine
 * videos… opens each of its files (combine-plan.ts). Each part's picture gets the single clip's filter, and picture
 * and sound are each held to exactly the part's length (its last frame kept, silence after its sound: Combine's
 * rule), so the concat filter's plain cut at each join keeps them together. The same encoders as the single clip.
 */
function joinedArgs(
  input: ClipPlan & { parts: readonly ClipPart[] },
  { decoder, sound, filter, webm, alpha }: ClipCodecs,
  dest: string,
): string[] {
  const track = String(input.audioTrack ?? 0);
  const graph: string[] = [];
  const joined: string[] = [];
  for (const [at, part] of input.parts.entries()) {
    const n = String(at);
    const length = seconds(part.endMs - part.startMs);
    graph.push(
      `[${n}:V:0]${filter},tpad=stop_mode=clone:stop_duration=${length},trim=end=${length}[v${n}]`,
      ...(sound ? [`[${n}:a:${track}]apad,atrim=end=${length}[a${n}]`] : []),
    );
    joined.push(sound ? `[v${n}][a${n}]` : `[v${n}]`);
  }
  graph.push(
    `${joined.join('')}concat=n=${String(input.parts.length)}:v=1:a=${sound ? '1' : '0'}[v]${sound ? '[a]' : ''}`,
  );
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:2',
    // The graph on one thread; an input's options cover only the -i after them, so each part opens with files only
    // and one decoding thread (as Combine videos…: a22-review-combine MUST-1).
    '-filter_complex_threads',
    '1',
    ...input.parts.flatMap((part) => [
      ...decoder,
      '-threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-ss',
      seconds(part.startMs),
      '-t',
      seconds(part.endMs - part.startMs),
      '-i',
      input.source,
    ]),
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[v]',
    ...(sound ? ['-map', '[a]'] : []),
    '-sn',
    '-dn',
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
    // No output -t trims the source's chapters here: FFmpeg would copy part 1's input's, shifted only by its start,
    // which no longer fit the joined clip's time (a24-review-vidparts N8). The one-part export keeps them, trimmed.
    '-map_chapters',
    '-1',
    '-metadata:s:v:0',
    'rotate=0',
    '-f',
    webm ? 'webm' : 'mp4',
    dest,
  ];
}
