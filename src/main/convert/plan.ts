/*
 * What a file Drashti cannot play becomes, and how FFmpeg makes it:
 *
 * - a video: H.264 in MP4 (with AAC sound), which every computer plays;
 * - a video with transparency (ProRes 4444, Animation, PNG frames): VP9 in
 *   WebM with its alpha kept, so a lower third stays see-through;
 * - a picture (HEIC, TIFF): JPEG, or PNG when it has transparency;
 * - a sound Chromium cannot play (AIFF, ADPCM WAV, WMA): AAC in M4A.
 *
 * What the file holds comes from FFmpeg reading it (`ffmpeg -i`), not from
 * its name.
 */

export type ConvertTarget = 'mp4' | 'webm-alpha' | 'jpeg' | 'png' | 'm4a';

export const TARGET_EXT: Record<ConvertTarget, string> = {
  mp4: 'mp4',
  'webm-alpha': 'webm',
  jpeg: 'jpg',
  png: 'png',
  m4a: 'm4a',
};

/** What the converted file is, for people. */
export const TARGET_FORMAT: Record<ConvertTarget, string> = {
  mp4: 'H.264 video (MP4), converted by Drashti',
  'webm-alpha': 'VP9 video with transparency (WebM), converted by Drashti',
  jpeg: 'JPEG picture, converted by Drashti',
  png: 'PNG picture, converted by Drashti',
  m4a: 'AAC sound file (M4A), converted by Drashti',
};

export interface MediaInfo {
  durationMs: number | null;
  video: { codec: string; pixFmt: string; width: number; height: number; still: boolean } | null;
  audio: { codec: string } | null;
}

/** Pixel formats that carry transparency. */
const ALPHA = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya8|ya16|rgb32|bgr32)/u;

export const hasAlpha = (info: MediaInfo): boolean => (info.video ? ALPHA.test(info.video.pixFmt) : false);

/** What `ffmpeg -i <file>` says about it (its message on stderr). */
export function parseFfmpegInfo(text: string): MediaInfo {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(text);
  const durationMs = d ? Math.round(((Number(d[1]) * 60 + Number(d[2])) * 60 + Number(d[3])) * 1000) : null;
  let video: MediaInfo['video'] = null;
  let audio: MediaInfo['audio'] = null;
  for (const line of text.split(/\r?\n/u)) {
    // A HEIC's tiles come as a stream group: it is one picture, the size of the grid.
    const group = /Stream group #\S+ Tile Grid: (\w+)[^,]*, (\w+)(?:\([^)]*\))?, (\d+)x(\d+)/u.exec(line);
    if (group && !video) {
      video = {
        codec: group[1] ?? '',
        pixFmt: group[2] ?? '',
        width: Number(group[3]),
        height: Number(group[4]),
        still: true,
      };
      continue;
    }
    const v = /Stream #\S+: Video: (\w+)[^,]*, (\w+)(?:\([^)]*\))?, (\d+)x(\d+)/u.exec(line);
    if (v && !video) {
      // A picture is one frame: no frame rate, or a cover picture ("attached pic").
      const still =
        line.includes('attached pic') || !/fps|tbr/u.test(line) || line.includes('Main Still Picture');
      video = { codec: v[1] ?? '', pixFmt: v[2] ?? '', width: Number(v[3]), height: Number(v[4]), still };
      continue;
    }
    const a = /Stream #\S+: Audio: (\w+)/u.exec(line);
    if (a && !audio) audio = { codec: a[1] ?? '' };
  }
  return { durationMs, video, audio };
}

/** What a file of this kind becomes; null when FFmpeg found nothing in it to convert. */
export function chooseTarget(kind: 'image' | 'video' | 'audio', info: MediaInfo): ConvertTarget | null {
  if (kind === 'image') return info.video ? (hasAlpha(info) ? 'png' : 'jpeg') : null;
  if (kind === 'audio') return info.audio ? 'm4a' : null;
  // A "video" that is really only sound (a WMA, say) becomes a sound file.
  if (!info.video || info.video.still) return info.audio ? 'm4a' : null;
  return hasAlpha(info) ? 'webm-alpha' : 'mp4';
}

/** FFmpeg's arguments to make `output` from `input` (progress on stderr). */
export function convertArgs(target: ConvertTarget, input: string, output: string, info: MediaInfo): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:2', '-y', '-i', input];
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  switch (target) {
    case 'mp4':
      return [
        ...head,
        '-map',
        '0:v:0',
        ...(info.audio ? ['-map', '0:a:0'] : []),
        '-vf',
        `${even},format=yuv420p`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        ...(info.audio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-movflags',
        '+faststart',
        output,
      ];
    case 'webm-alpha':
      return [
        ...head,
        '-map',
        '0:v:0',
        ...(info.audio ? ['-map', '0:a:0'] : []),
        '-vf',
        `${even},format=yuva420p`,
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-crf',
        '30',
        '-b:v',
        '0',
        '-row-mt',
        '1',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-auto-alt-ref',
        '0',
        ...(info.audio ? ['-c:a', 'libopus', '-b:a', '160k'] : []),
        output,
      ];
    case 'jpeg':
      return [...head, '-frames:v', '1', '-q:v', '2', output];
    case 'png':
      return [...head, '-frames:v', '1', output];
    case 'm4a':
      return [...head, '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', output];
  }
}
