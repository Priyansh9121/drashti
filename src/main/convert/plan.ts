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
 *
 * Session 50: every video and sound is read so at import, and what Drashti's
 * player cannot play (its container, its picture or its sound: PLAYER says
 * what it plays) is converted by itself. A picture that plays (H.264) is
 * copied as it is, so an MKV whose sound is AC-3 only has its sound made again.
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
  /**
   * The container, by FFmpeg's name for it ("matroska,webm", "mov,mp4,m4a,3gp,3g2,mj2", "avi"; Session 50);
   * null when FFmpeg could not open the file, and left out where it was not read.
   */
  container?: string | null;
  durationMs: number | null;
  video: { codec: string; pixFmt: string; width: number; height: number; still: boolean } | null;
  audio: { codec: string } | null;
}

/** Pixel formats that carry transparency. */
const ALPHA = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya8|ya16|rgb32|bgr32)/u;

export const hasAlpha = (info: MediaInfo): boolean => (info.video ? ALPHA.test(info.video.pixFmt) : false);

/** What `ffmpeg -i <file>` says about it (its message on stderr). */
export function parseFfmpegInfo(text: string): MediaInfo {
  // "Input #0, matroska,webm, from '/path/clip.mkv':" (the first ", from '" ends the name; the path may hold one).
  const container = /^Input #\d+, (.+?), from '/mu.exec(text)?.[1] ?? null;
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
  return { container, durationMs, video, audio };
}

/**
 * What Drashti's player plays (Session 50): Chromium's own media in Electron 44, by FFmpeg's names, as data.
 * A file plays when its container is one of these, and its picture and its sound (the first of each) too.
 * Anything else is converted by itself at import (atImport).
 */
export const PLAYER = {
  /** MP4, MOV, M4A, 3GP and F4V; MKV and WebM; Ogg; MP3; WAV; FLAC; AAC (ADTS). */
  containers: new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', 'ogg', 'mp3', 'wav', 'flac', 'aac']),
  /** Pictures: H.264 (8-bit 4:2:0 only, as h264PixelFormats says), VP8, VP9 and AV1. */
  video: new Set(['h264', 'vp8', 'vp9', 'av1']),
  /** The H.264 Chromium decodes: 8-bit 4:2:0 (10-bit or 4:2:2 H.264 plays black). */
  h264PixelFormats: new Set(['yuv420p', 'yuvj420p']),
  /** HEVC plays where the computer decodes it: the window asks (convert-store's playsHevc), never the import. */
  hevc: 'hevc',
  /** Sounds: AAC, MP3, Opus, Vorbis, FLAC and uncompressed (PCM) sound. AC-3, E-AC-3 and DTS play silent. */
  audio: new Set([
    'aac',
    'mp3',
    'opus',
    'vorbis',
    'flac',
    'pcm_u8',
    'pcm_s16le',
    'pcm_s24le',
    'pcm_s32le',
    'pcm_f32le',
    'pcm_s16be',
    'pcm_s24be',
    'pcm_alaw',
    'pcm_mulaw',
  ]),
};

/** What an import does with a video or sound file, from what FFmpeg read in it (Session 50). */
export type AtImport =
  /** It plays as it is: never converted. */
  | 'plays'
  /** Drashti's player cannot play it (its container, its picture or its sound): converted by itself. */
  | 'convert'
  /** HEVC: it plays where the computer decodes it, and the window offers Convert where it cannot. */
  | 'hevc'
  /** FFmpeg found no picture or sound in it to play: its own header decides, as before (import/probe.ts). */
  | 'unread';

/** A video file's moving picture: not a sound file's, nor one frame (an MP3's cover). */
const pictureOf = (kind: 'video' | 'audio', info: MediaInfo): MediaInfo['video'] =>
  kind === 'video' && info.video && !info.video.still ? info.video : null;

/** Whether the player shows this picture: yes, no, or only where the computer decodes HEVC. */
function pictureVerdict(video: NonNullable<MediaInfo['video']>): 'plays' | 'no' | 'hevc' {
  if (video.codec === PLAYER.hevc) return 'hevc';
  if (!PLAYER.video.has(video.codec)) return 'no';
  return video.codec !== 'h264' || PLAYER.h264PixelFormats.has(video.pixFmt) ? 'plays' : 'no';
}

/** What an import does with a video or sound file Drashti took, from what FFmpeg read in it (Session 50). */
export function atImport(kind: 'video' | 'audio', info: MediaInfo): AtImport {
  const picture = pictureOf(kind, info);
  if ((!picture && !info.audio) || chooseTarget(kind, info) === null) return 'unread';
  const shown = picture ? pictureVerdict(picture) : 'plays';
  const opens = PLAYER.containers.has(info.container ?? '');
  const heard = info.audio === null || PLAYER.audio.has(info.audio.codec);
  if (!opens || shown === 'no' || !heard) return 'convert';
  return shown === 'hevc' ? 'hevc' : 'plays';
}

/** Containers for people, and the codecs that are their own (named once: "AC-3 sound file"). */
const CONTAINERS: Record<string, { name: string; own?: readonly string[] }> = {
  'matroska,webm': { name: 'Matroska' },
  'mov,mp4,m4a,3gp,3g2,mj2': { name: 'MP4' },
  avi: { name: 'AVI' },
  asf: {
    name: 'Windows Media',
    own: ['wmv1', 'wmv2', 'wmv3', 'vc1', 'wmav1', 'wmav2', 'wmapro', 'wmalossless', 'wmavoice'],
  },
  flv: { name: 'Flash video', own: ['flv1'] },
  mpegts: { name: 'MPEG transport stream' },
  mpeg: { name: 'DVD-style MPEG' },
  mxf: { name: 'MXF' },
  dv: { name: 'DV', own: ['dvvideo'] },
  ogg: { name: 'Ogg' },
  aiff: { name: 'AIFF' },
  au: { name: 'AU' },
  caf: { name: 'CAF' },
  wav: { name: 'WAV' },
  w64: { name: 'Wave64' },
  flac: { name: 'FLAC', own: ['flac'] },
  mp3: { name: 'MPEG audio', own: ['mp1', 'mp2', 'mp3'] },
  aac: { name: 'ADTS', own: ['aac'] },
  ac3: { name: 'AC-3', own: ['ac3'] },
  eac3: { name: 'E-AC-3', own: ['eac3'] },
  dts: { name: 'DTS', own: ['dts'] },
  wv: { name: 'WavPack', own: ['wavpack'] },
  ape: { name: 'Monkey’s Audio', own: ['ape'] },
  amr: { name: 'AMR', own: ['amr_nb', 'amr_wb'] },
  tta: { name: 'TTA', own: ['tta'] },
  rm: { name: 'RealMedia', own: ['rv10', 'rv20', 'rv30', 'rv40', 'cook', 'sipr', 'ra_144', 'ra_288'] },
};

/** The ISO and Matroska families by the file's own extension: a .mov is QuickTime, a .webm WebM. */
const BY_EXTENSION: Record<string, string> = {
  mov: 'QuickTime',
  qt: 'QuickTime',
  m4a: 'M4A',
  m4b: 'M4A',
  m4r: 'M4A',
  '3gp': '3GP',
  '3g2': '3GP',
  f4v: 'F4V',
  webm: 'WebM',
  weba: 'WebM',
};

const PICTURE_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC (H.265)',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4 Part 2',
  msmpeg4v1: 'MPEG-4 Part 2 (Microsoft)',
  msmpeg4v2: 'MPEG-4 Part 2 (Microsoft)',
  msmpeg4v3: 'MPEG-4 Part 2 (Microsoft)',
  h263: 'H.263',
  mpeg1video: 'MPEG-1',
  mpeg2video: 'MPEG-2',
  theora: 'Theora',
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  mjpeg: 'Motion JPEG',
  wmv1: 'Windows Media',
  wmv2: 'Windows Media',
  wmv3: 'Windows Media',
  vc1: 'VC-1',
  flv1: 'Flash (Sorenson Spark)',
  dvvideo: 'DV',
  cinepak: 'Cinepak',
  rv10: 'RealVideo',
  rv20: 'RealVideo',
  rv30: 'RealVideo',
  rv40: 'RealVideo',
  png: 'PNG frames',
  qtrle: 'Animation (RLE)',
  hap: 'HAP',
  cfhd: 'CineForm',
  rawvideo: 'uncompressed',
  v210: 'uncompressed',
  svq1: 'Sorenson Video',
  svq3: 'Sorenson Video 3',
};

const SOUND_NAMES: Record<string, string> = {
  aac: 'AAC',
  mp3: 'MP3',
  mp2: 'MP2',
  mp1: 'MP1',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  mlp: 'MLP',
  alac: 'Apple Lossless',
  wmav1: 'Windows Media Audio',
  wmav2: 'Windows Media Audio',
  wmapro: 'Windows Media Audio Pro',
  wmalossless: 'Windows Media Audio Lossless',
  wmavoice: 'Windows Media Voice',
  amr_nb: 'AMR',
  amr_wb: 'AMR wideband',
  ape: 'Monkey’s Audio',
  wavpack: 'WavPack',
  tta: 'TTA',
  cook: 'RealAudio',
  sipr: 'RealAudio',
  ra_144: 'RealAudio',
  ra_288: 'RealAudio',
  speex: 'Speex',
  gsm: 'GSM',
};

const soundName = (codec: string): string =>
  SOUND_NAMES[codec] ??
  (codec.startsWith('pcm_') ? 'uncompressed' : codec.startsWith('adpcm_') ? 'ADPCM' : codec);

/**
 * What a video or sound file is, for people (Session 50: the import report and the media list), from what
 * FFmpeg read: "H.264 video with AC-3 sound (Matroska)", "Windows Media Audio sound file", "AIFF sound file".
 * HEVC is named so (shared/convert.ts's isHevc reads it).
 */
export function describeMedia(kind: 'video' | 'audio', info: MediaInfo, ext: string): string {
  const family = info.container ? CONTAINERS[info.container] : undefined;
  const own = (codec: string) => family?.own?.includes(codec) ?? false;
  const where = BY_EXTENSION[ext.toLowerCase()] ?? family?.name ?? info.container ?? 'unknown';
  const picture = pictureOf(kind, info);
  const sound = info.audio;
  if (picture) {
    const named = PICTURE_NAMES[picture.codec] ?? picture.codec;
    const shown =
      picture.codec === 'h264' && !PLAYER.h264PixelFormats.has(picture.pixFmt)
        ? `${named} (${picture.pixFmt})`
        : named;
    const heard = sound ? ` with ${soundName(sound.codec)} sound` : '';
    return own(picture.codec) ? `${shown} video${heard}` : `${shown} video${heard} (${where})`;
  }
  if (!sound) return `${where} file`;
  // Uncompressed sound is known by its container: "AIFF sound file".
  if (sound.codec.startsWith('pcm_')) return `${where} sound file`;
  return own(sound.codec)
    ? `${soundName(sound.codec)} sound file`
    : `${soundName(sound.codec)} sound file (${where})`;
}

/**
 * Containers whose timing a copied picture keeps exactly (Session 50): an AVI's or an ASF's often has no
 * presentation times, so its picture is made again.
 */
const COPIES_FROM = new Set(['matroska,webm', 'mov,mp4,m4a,3gp,3g2,mj2', 'mpegts', 'flv', 'mpeg']);

/** A picture Drashti's player shows as it is (H.264, 8-bit 4:2:0), in a container it can be copied from. */
export const keepsPicture = (info: MediaInfo): boolean =>
  info.video !== null &&
  !info.video.still &&
  pictureVerdict(info.video) === 'plays' &&
  info.video.codec === 'h264' &&
  COPIES_FROM.has(info.container ?? '');

/** What a file of this kind becomes; null when FFmpeg found nothing in it to convert. */
export function chooseTarget(kind: 'image' | 'video' | 'audio', info: MediaInfo): ConvertTarget | null {
  if (kind === 'image') return info.video ? (hasAlpha(info) ? 'png' : 'jpeg') : null;
  if (kind === 'audio') return info.audio ? 'm4a' : null;
  // A "video" that is really only sound (a WMA, say) becomes a sound file.
  if (!info.video || info.video.still) return info.audio ? 'm4a' : null;
  return hasAlpha(info) ? 'webm-alpha' : 'mp4';
}

/**
 * FFmpeg's arguments to make `output` from `input` (progress on stderr). `maxHeight` (Session 25b): a
 * video taller than that is made that tall, keeping its shape (a downloaded 2160p video becomes 1080p).
 */
export function convertArgs(
  target: ConvertTarget,
  input: string,
  output: string,
  info: MediaInfo,
  options: { maxHeight?: number } = {},
): string[] {
  // Only files may be opened (Session 31, MED-6): a file naming another place (a playlist, concat:,
  // a network address) is never followed.
  const head = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:2',
    '-y',
    '-protocol_whitelist',
    'file',
    '-i',
    input,
  ];
  const even =
    options.maxHeight === undefined
      ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
      : `scale=-2:'trunc(min(ih,${String(options.maxHeight)})/2)*2'`;
  switch (target) {
    case 'mp4':
      // A picture that plays is copied as it is (Session 50): only the container or the sound was wrong.
      if (options.maxHeight === undefined && keepsPicture(info))
        return [
          ...head,
          '-map',
          '0:v:0',
          ...(info.audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k'] : []),
          '-c:v',
          'copy',
          '-movflags',
          '+faststart',
          output,
        ];
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
