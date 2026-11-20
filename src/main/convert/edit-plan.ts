import { videoEditRecipeSchema, type VideoEditRecipe, type VideoEditFrame } from '../../shared/video-edit';
import { hasAlpha, type MediaInfo } from './plan';

export interface EditPlanInput {
  file: string;
  recipe: VideoEditRecipe;
  info: MediaInfo;
  identity: string;
  /** Export may choose a narrower source-time interval, inside the saved trim. */
  range?: { startMs: number; endMs: number };
  frame?: VideoEditFrame;
  fit?: 'contain' | 'cover';
}
export interface EditPlan {
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  target: 'mp4' | 'webm';
  args(output: string): string[];
}

const seconds = (ms: number) => (ms / 1000).toFixed(6);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** One decode and one prepared file. No file is opened while building this immutable plan. */
export function editPlan(input: EditPlanInput): EditPlan {
  const r = videoEditRecipeSchema.parse(input.recipe);
  const video = input.info.video;
  const length = input.info.durationMs;
  if (!video || !length || length <= 0 || video.width <= 0 || video.height <= 0)
    throw new Error('The video has no readable picture or length. Check its source before preparing it.');
  const start = r.trim.startMs ?? 0;
  const end = r.trim.endMs ?? length;
  const sourceStartMs = input.range?.startMs ?? start;
  const sourceEndMs = input.range?.endMs ?? end;
  if (
    start >= end ||
    end > length ||
    sourceStartMs < start ||
    sourceEndMs > end ||
    sourceStartMs >= sourceEndMs
  )
    throw new Error('The chosen start and end must be inside the video and its saved trim.');
  const durationMs = (sourceEndMs - sourceStartMs) / r.speed;
  if (Object.values(r.fades).some((ms) => ms > (end - start) / r.speed))
    throw new Error('A fade is longer than the prepared video. Shorten it and save again.');
  const alpha = hasAlpha(input.info);
  const target = alpha ? 'webm' : 'mp4';
  const p = r.picture;
  const shape = input.frame ?? p.frame ?? 'source';
  const ratios: Record<Exclude<VideoEditFrame, 'source'>, number> = {
    '16:9': 16 / 9,
    '4:3': 4 / 3,
    '1:1': 1,
    '9:16': 9 / 16,
  };
  const long = Math.min(4096, Math.max(video.width, video.height));
  const ratio = shape === 'source' ? null : ratios[shape];
  const width = ratio === null ? null : even(ratio >= 1 ? long : long * ratio);
  const height = ratio === null ? null : even(ratio >= 1 ? long / ratio : long);
  const prep = [
    `trim=duration=${seconds(sourceEndMs - sourceStartMs)}`,
    `setpts=(PTS-STARTPTS)/${String(r.speed)}`,
    ...(video.interlaced ? ['bwdif=mode=send_frame:deint=interlaced'] : []),
    "scale=w='max(2,round(iw*sar/2)*2)':h=ih",
    'setsar=1',
    ...(p.turn === 90
      ? ['transpose=clock']
      : p.turn === 180
        ? ['hflip', 'vflip']
        : p.turn === 270
          ? ['transpose=cclock']
          : []),
    ...(p.flipX ? ['hflip'] : []),
    ...(p.flipY ? ['vflip'] : []),
    `crop=w=iw*${String(p.crop.w)}:h=ih*${String(p.crop.h)}:x=iw*${String(p.crop.x)}:y=ih*${String(p.crop.y)}:exact=1`,
    "scale=w='max(2,trunc(iw/2)*2)':h='max(2,trunc(ih/2)*2)'",
    'format=rgba',
  ];
  const canvas =
    width === null || height === null
      ? 'null'
      : `scale=${String(width)}:${String(height)}:force_original_aspect_ratio=increase,crop=${String(width)}:${String(height)}`;
  const foreground =
    width === null || height === null
      ? `scale=w='max(2,round(iw*${String(p.zoom)}/2)*2)':h='max(2,round(ih*${String(p.zoom)}/2)*2)'`
      : `scale=${String(even(width * p.zoom))}:${String(even(height * p.zoom))}:force_original_aspect_ratio=${input.fit === 'cover' ? 'increase' : 'decrease'}`;
  const base = p.fill
    ? 'gblur=sigma=20,colorchannelmixer=rr=0.55:gg=0.55:bb=0.55'
    : `colorchannelmixer=rr=0:gg=0:bb=0:aa=${alpha ? '0' : '1'}`;
  const effects: string[] = [];
  // Match the editor's multiplicative brightness and contrast about the middle grey.
  if (p.brightness !== 0 || p.contrast !== 0) {
    const expression = `clip(((val*(1+${String(p.brightness)})-maxval/2)*(1+${String(p.contrast)})+maxval/2),0,maxval)`;
    effects.push(`lutrgb=r='${expression}':g='${expression}':b='${expression}'`);
  }
  if (p.colour !== 0) {
    const s = 1 + p.colour;
    const mix = (lum: number, diagonal: boolean) => String(lum * (1 - s) + (diagonal ? s : 0));
    effects.push(
      `colorchannelmixer=rr=${mix(0.2126, true)}:rg=${mix(0.7152, false)}:rb=${mix(0.0722, false)}:gr=${mix(0.2126, false)}:gg=${mix(0.7152, true)}:gb=${mix(0.0722, false)}:br=${mix(0.2126, false)}:bg=${mix(0.7152, false)}:bb=${mix(0.0722, true)}`,
    );
  }
  // An export inside the recipe samples its fades at the corresponding prepared time.
  const offset = (sourceStartMs - start) / r.speed;
  if (offset > 0) effects.push(`setpts=PTS+${seconds(offset)}/TB`);
  if (r.fades.pictureInMs > 0) effects.push(`fade=t=in:st=0:d=${seconds(r.fades.pictureInMs)}`);
  if (r.fades.pictureOutMs > 0)
    effects.push(
      `fade=t=out:st=${seconds((end - start) / r.speed - r.fades.pictureOutMs)}:d=${seconds(r.fades.pictureOutMs)}`,
    );
  if (offset > 0) effects.push('setpts=PTS-STARTPTS');
  effects.push(`format=${alpha ? 'yuva420p' : 'yuv420p'}`);
  const filters = [
    `[0:V:0]${prep.join(',')},split=2[front][back]`,
    `[front]${foreground}[foreground]`,
    `[back]${canvas},${base}[canvas]`,
    `[canvas][foreground]overlay=x='(W-w)/2+${String(p.x)}*W':y='(H-h)/2+${String(p.y)}*H':format=auto:shortest=1,${effects.join(',')}[picture]`,
  ];
  if (input.info.audio) {
    const sound = [
      `atrim=duration=${seconds(sourceEndMs - sourceStartMs)}`,
      'asetpts=PTS-STARTPTS',
      ...(r.noiseReduction ? ['afftdn=nf=-35'] : []),
      `atempo=${String(r.speed)}`,
    ];
    if (offset > 0) sound.push(`asetpts=PTS+${seconds(offset)}/TB`);
    if (r.fades.soundInMs > 0) sound.push(`afade=t=in:st=0:d=${seconds(r.fades.soundInMs)}`);
    if (r.fades.soundOutMs > 0)
      sound.push(
        `afade=t=out:st=${seconds((end - start) / r.speed - r.fades.soundOutMs)}:d=${seconds(r.fades.soundOutMs)}`,
      );
    if (offset > 0) sound.push('asetpts=PTS-STARTPTS');
    filters.push(`[0:a:${String(r.audioTrack ?? 0)}]${sound.join(',')}[sound]`);
  } else if (r.audioTrack !== null) throw new Error('This source has no audio track to choose.');
  return {
    sourceStartMs,
    sourceEndMs,
    durationMs,
    target,
    args: (output) => [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostats',
      '-nostdin',
      '-progress',
      'pipe:2',
      '-y',
      '-protocol_whitelist',
      'file',
      '-threads',
      '1',
      ...(alpha && /^vp[89]$/u.test(video.codec)
        ? ['-c:V:0', video.codec === 'vp8' ? 'libvpx' : 'libvpx-vp9']
        : []),
      '-ss',
      seconds(sourceStartMs),
      '-i',
      input.file,
      '-filter_complex_threads',
      '1',
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[picture]',
      ...(input.info.audio ? ['-map', '[sound]'] : []),
      '-t',
      seconds(durationMs),
      '-c:v',
      alpha ? 'libvpx-vp9' : 'libx264',
      '-threads:v',
      '1',
      ...(alpha
        ? ['-crf', '30', '-b:v', '0', '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '4']
        : ['-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart+use_metadata_tags']),
      ...(input.info.audio ? ['-c:a', alpha ? 'libopus' : 'aac', '-b:a', alpha ? '160k' : '192k'] : []),
      '-map_metadata',
      '0',
      '-metadata:s:v:0',
      'rotate=0',
      '-metadata',
      `drashti_edit_id=${input.identity}`,
      '-fps_mode:v',
      'passthrough',
      '-f',
      target,
      output,
    ],
  };
}
