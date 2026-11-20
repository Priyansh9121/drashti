import type {
  CaptionTrack,
  CoverPicture,
  FileRead,
  PictureTrack,
  SoundTrack,
} from '../../shared/media-details';
import { BY_EXTENSION, CONTAINERS, PICTURE_NAMES, SOUND_NAMES } from './plan';

/*
 * What a file holds, for Media information… (alpha.20, Q60-34 item 1), from what the bundled FFmpeg prints when it is
 * asked to read it (`ffmpeg -i`, on stderr; Drashti bundles no ffprobe): each stream's line names its codec, then in
 * brackets the decoder where it differs, its profile and its tag ("h264 (High) (avc1 / 0x31637661)"), then its pixels
 * with their range, colour and scan ("yuv420p10le(tv, bt2020nc/bt2020/smpte2084, progressive)"), its size and shape, its
 * bit rate and frame rate, and its flags ("(default)", "(attached pic)"). FFmpeg prints no level: that is read from the
 * file's own codec record (import/codec-config.ts). Pure: nothing here runs anything.
 */

/** Containers for people, as Media information names them (the import's own names otherwise, convert/plan.ts). */
const CONTAINER_NAMES: Record<string, string> = {
  'mov,mp4,m4a,3gp,3g2,mj2': 'MP4',
  'matroska,webm': 'Matroska',
  mp3: 'MP3',
  aac: 'AAC (ADTS)',
  flac: 'FLAC',
  wav: 'WAV',
  ogg: 'Ogg',
  avi: 'AVI',
  mpegts: 'MPEG transport stream',
};

/** Decoders FFmpeg names in brackets after a codec, where the decoder is not the codec's own name. */
const DECODERS =
  /^(lib[\w-]+|\w+float|\w+_fixed|\w+_(cuvid|qsv|videotoolbox|mediacodec|v4l2m2m|amf|vulkan)|srt|ssa)$/u;

/** A codec's tag in brackets: "avc1 / 0x31637661", "[1][0][0][0] / 0x0001". */
const TAG = /\/ 0x[0-9a-fA-F]+$/u;

/** Captions' codecs for people. */
const CAPTION_NAMES: Record<string, string> = {
  subrip: 'SubRip (SRT)',
  srt: 'SubRip (SRT)',
  ass: 'SubStation Alpha',
  ssa: 'SubStation Alpha',
  webvtt: 'WebVTT',
  mov_text: 'MP4 text',
  text: 'Plain text',
  dvd_subtitle: 'DVD subtitles (pictures)',
  hdmv_pgs_subtitle: 'Blu-ray subtitles (pictures)',
  dvb_subtitle: 'DVB subtitles (pictures)',
  eia_608: 'Closed captions (608)',
};

/** A cover picture's codec for people. */
const COVER_NAMES: Record<string, string> = {
  mjpeg: 'JPEG',
  png: 'PNG',
  bmp: 'BMP',
  gif: 'GIF',
  webp: 'WebP',
  tiff: 'TIFF',
};

/** Languages a file names (ISO 639-2, and the two-letter codes), for people. 'und' and 'zxx' name none. */
const LANGUAGES: Record<string, string> = {
  eng: 'English',
  en: 'English',
  guj: 'Gujarati',
  gu: 'Gujarati',
  hin: 'Hindi',
  hi: 'Hindi',
  san: 'Sanskrit',
  sa: 'Sanskrit',
  mar: 'Marathi',
  mr: 'Marathi',
  ben: 'Bengali',
  bn: 'Bengali',
  tam: 'Tamil',
  ta: 'Tamil',
  tel: 'Telugu',
  te: 'Telugu',
  kan: 'Kannada',
  kn: 'Kannada',
  mal: 'Malayalam',
  ml: 'Malayalam',
  pan: 'Punjabi',
  pa: 'Punjabi',
  urd: 'Urdu',
  ur: 'Urdu',
  ori: 'Odia',
  or: 'Odia',
  asm: 'Assamese',
  as: 'Assamese',
  nep: 'Nepali',
  ne: 'Nepali',
  snd: 'Sindhi',
  sd: 'Sindhi',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  spa: 'Spanish',
  es: 'Spanish',
  ita: 'Italian',
  it: 'Italian',
  por: 'Portuguese',
  pt: 'Portuguese',
  dut: 'Dutch',
  nld: 'Dutch',
  nl: 'Dutch',
  swa: 'Swahili',
  sw: 'Swahili',
  ara: 'Arabic',
  ar: 'Arabic',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  ko: 'Korean',
  rus: 'Russian',
  ru: 'Russian',
  mul: 'Several languages',
};

/** A file's language code for people ("guj": "Gujarati"); null for none said ('und', 'zxx'); the code when unknown. */
export function languageName(code: string | null | undefined): string | null {
  const c = code?.trim().toLowerCase() ?? '';
  if (c === '' || c === 'und' || c === 'zxx') return null;
  const known = LANGUAGES[c];
  if (known) return known;
  try {
    const named = new Intl.DisplayNames(['en'], { type: 'language' }).of(c);
    if (named && named.toLowerCase() !== c) return named;
  } catch {
    // Not a language code Intl knows: the code itself, below.
  }
  return c;
}

/** The parts of a stream's line, split at its commas outside brackets. */
export function topLevelParts(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(line.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(line.slice(from).trim());
  return parts.filter((p) => p !== '');
}

/** A stream's codec and its profile, from the first part of its line ("av1 (libdav1d) (Main) (av01 / 0x…)"). */
function codecOf(part: string): { codec: string; profile: string | null } {
  const codec = /^([\w-]+)/u.exec(part)?.[1] ?? '';
  const brackets = [...part.slice(codec.length).matchAll(/\(([^()]*)\)/gu)].map((m) => (m[1] ?? '').trim());
  const profile = brackets.find((b) => b !== '' && !TAG.test(b) && !DECODERS.test(b)) ?? null;
  return { codec, profile };
}

/** A part with its flags at its end taken off: "71 kb/s (default)" is "71 kb/s". */
const bare = (part: string): string =>
  part.replace(/(\s*\((default|forced|attached pic|dependent)\))+$/u, '');

/** A number FFmpeg writes with an optional k ("30k"): 30000. */
function amount(text: string): number {
  return text.endsWith('k') ? Number(text.replace(/k$/u, '')) * 1000 : Number(text);
}

/** Bits for each colour, and how its colour is kept, from FFmpeg's name for its pixels. */
function pixelsOf(pixFmt: string): { bitDepth: number | null; chroma: string | null; alpha: boolean } {
  const f = pixFmt.toLowerCase();
  const alpha = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya\d)/u.test(f);
  const yuv = /^yuva?j?(4\d\d)p(\d+)?(le|be)?$/u.exec(f);
  if (yuv) {
    const c = yuv[1] ?? '';
    return {
      bitDepth: yuv[2] ? Number(yuv[2]) : 8,
      chroma: `${c[0] ?? ''}:${c[1] ?? ''}:${c[2] ?? ''}`,
      alpha,
    };
  }
  if (/^nv(12|21)$/u.test(f)) return { bitDepth: 8, chroma: '4:2:0', alpha };
  const semi = /^p0(10|12|16)(le|be)$/u.exec(f);
  if (semi) return { bitDepth: Number(semi[1]), chroma: '4:2:0', alpha };
  const p2 = /^p2(10|12|16)(le|be)$/u.exec(f);
  if (p2) return { bitDepth: Number(p2[1]), chroma: '4:2:2', alpha };
  const gbr = /^gbra?p(\d+)?(le|be)?$/u.exec(f);
  if (gbr) return { bitDepth: gbr[1] ? Number(gbr[1]) : 8, chroma: 'RGB', alpha };
  if (/^(rgb|bgr)(48|64)/u.test(f)) return { bitDepth: 16, chroma: 'RGB', alpha };
  if (/^(rgb|bgr|argb|abgr|rgba|bgra|0rgb|rgb0|0bgr|bgr0)/u.test(f))
    return { bitDepth: 8, chroma: 'RGB', alpha };
  const grey = /^(gray|ya)(\d+)?(le|be)?$/u.exec(f);
  if (grey) return { bitDepth: grey[2] && grey[2] !== '8' ? Number(grey[2]) : 8, chroma: 'Greyscale', alpha };
  return { bitDepth: null, chroma: null, alpha };
}

/** A moving picture's (or a cover's) line, from its parts after the codec. */
function pictureOf(rest: string, language: string | null): PictureTrack {
  const parts = topLevelParts(rest);
  const { codec, profile } = codecOf(parts[0] ?? '');
  const track: PictureTrack = {
    codec,
    codecName: PICTURE_NAMES[codec] ?? codec,
    profile,
    level: null,
    pixFmt: '',
    bitDepth: null,
    chroma: null,
    hdr: null,
    alpha: false,
    width: 0,
    height: 0,
    sar: null,
    dar: null,
    fps: null,
    scan: null,
    bitRateKbps: null,
    language: languageName(language),
    title: null,
  };
  let tbr: number | null = null;
  for (const raw of parts.slice(1)) {
    const part = bare(raw);
    const size = /^(\d+)x(\d+)(?:\s*\[SAR (\d+:\d+) DAR (\d+:\d+)\])?/u.exec(part);
    if (size) {
      track.width = Number(size[1]);
      track.height = Number(size[2]);
      if (size[3]) track.sar = size[3];
      if (size[4]) track.dar = size[4];
      continue;
    }
    const shape = /^SAR (\d+:\d+) DAR (\d+:\d+)$/u.exec(part);
    if (shape) {
      track.sar = shape[1] ?? null;
      track.dar = shape[2] ?? null;
      continue;
    }
    const kbps = /^(\d+(?:\.\d+)?) kb\/s$/u.exec(part);
    if (kbps) {
      track.bitRateKbps = Number(kbps[1]);
      continue;
    }
    const fps = /^(\d+(?:\.\d+)?k?) fps$/u.exec(part);
    if (fps) {
      track.fps = amount(fps[1] ?? '');
      continue;
    }
    const rate = /^(\d+(?:\.\d+)?k?) tbr$/u.exec(part);
    if (rate) {
      tbr = amount(rate[1] ?? '');
      continue;
    }
    // Its pixels, once: "yuv420p(tv, bt709, progressive)", "yuv422p10le", "yuvj420p(pc, bt470bg/unknown/unknown)".
    const pixels = track.pixFmt === '' ? /^([a-z][a-z0-9_]*)(?:\((.*)\))?$/u.exec(part) : null;
    if (pixels && !/ (tbn|tbc|kb\/s)$/u.test(part)) {
      track.pixFmt = pixels[1] ?? '';
      Object.assign(track, pixelsOf(track.pixFmt));
      for (const inside of topLevelParts(pixels[2] ?? '')) {
        if (inside === 'progressive') track.scan = 'progressive';
        else if (inside.startsWith('top')) track.scan = 'top first';
        else if (inside.startsWith('bottom')) track.scan = 'bottom first';
        else {
          // Colour: one name for all three, or "space/primaries/transfer".
          const transfer = inside.split('/').at(-1) ?? '';
          if (transfer === 'smpte2084') track.hdr = 'pq';
          else if (transfer === 'arib-std-b67') track.hdr = 'hlg';
        }
      }
    }
  }
  // A frame rate FFmpeg gives only as tbr (a cover's is its timebase's: never one).
  if (track.fps === null && tbr !== null && tbr < 1000) track.fps = tbr;
  return track;
}

/** FFmpeg's sample formats ("fltp", "s32 (24 bit)"). */
const SAMPLE_FORMAT = /^(u8|s16|s32|s64|flt|dbl)p?\b/u;

/** Sound kept whole (uncompressed or lossless), whose bits a sample are worth saying. */
const WHOLE_SOUND = new Set(['flac', 'alac', 'wavpack', 'ape', 'tta', 'mlp', 'truehd']);

/** Bits a sample by FFmpeg's sample format, where it does not say them itself. */
const FORMAT_BITS: Record<string, number> = { u8: 8, s16: 16, s32: 32, flt: 32, s64: 64, dbl: 64 };

/** Bits a sample of uncompressed or lossless sound, from its codec and sample format ("s32 (24 bit)"); else null. */
function soundBits(codec: string, format: string): number | null {
  if (!codec.startsWith('pcm_') && !WHOLE_SOUND.has(codec)) return null;
  const said = /\((\d+) bit\)/u.exec(format);
  if (said) return Number(said[1]);
  return FORMAT_BITS[SAMPLE_FORMAT.exec(format)?.[1] ?? ''] ?? null;
}

/** A sound codec for people: "AAC", "Uncompressed (PCM)". */
function soundCodecName(codec: string): string {
  if (codec.startsWith('pcm_')) return 'Uncompressed (PCM)';
  if (codec.startsWith('adpcm_')) return 'ADPCM';
  return SOUND_NAMES[codec] ?? codec;
}

/** A sound track's line, from its parts after the codec: "44100 Hz, 5.1(side), fltp, 447 kb/s". */
function soundOf(rest: string, language: string | null): SoundTrack {
  const parts = topLevelParts(rest);
  const { codec, profile } = codecOf(parts[0] ?? '');
  const track: SoundTrack = {
    codec,
    codecName: soundCodecName(codec),
    profile,
    sampleRateHz: null,
    channels: null,
    bitDepth: null,
    bitRateKbps: null,
    language: languageName(language),
    title: null,
  };
  let afterRate = false;
  for (const raw of parts.slice(1)) {
    const part = bare(raw);
    const hz = /^(\d+) Hz$/u.exec(part);
    if (hz) {
      track.sampleRateHz = Number(hz[1]);
      afterRate = true;
      continue;
    }
    const kbps = /^(\d+(?:\.\d+)?) kb\/s$/u.exec(part);
    if (kbps) {
      track.bitRateKbps = Number(kbps[1]);
      continue;
    }
    if (SAMPLE_FORMAT.test(part)) {
      track.bitDepth = soundBits(codec, part);
      continue;
    }
    // Its channels come straight after its sample rate.
    if (afterRate && track.channels === null && !part.startsWith('start ')) track.channels = part;
    afterRate = false;
  }
  return track;
}

const INPUT = /^Input #0, (.+?), from '/u;
const DURATION =
  /^\s*Duration: (?:(\d+):(\d+):(\d+(?:\.\d+)?)|N\/A)(?:, start: [^,]+)?, bitrate: (?:(\d+(?:\.\d+)?) kb\/s|N\/A)/u;
const STREAM =
  /^\s*Stream #0:\d+(?:\[0x[0-9a-fA-F]+\])?(?:\(([A-Za-z-]+)\))?: (Video|Audio|Subtitle|Data|Attachment): (.*)$/u;
const METADATA = /^\s+([A-Za-z0-9_-]+)\s*: (.*)$/u;

/** Its container for people: by its own extension in the ISO and Matroska families, else by FFmpeg's name. */
function containerName(container: string | null, ext: string): string | null {
  if (container === null) return null;
  const e = ext.toLowerCase().replace(/^\./u, '');
  const family = container === 'mov,mp4,m4a,3gp,3g2,mj2' || container === 'matroska,webm';
  if (family && BY_EXTENSION[e]) return BY_EXTENSION[e];
  return CONTAINER_NAMES[container] ?? CONTAINERS[container]?.name ?? container;
}

/**
 * What FFmpeg's text says the file holds (the first input only), with its container named by the file's extension
 * (`ext`, without the dot) where that says more ("mov": QuickTime). Lines it does not know change nothing.
 */
export function parseMediaDetails(text: string, ext: string): FileRead {
  let container: string | null = null;
  let durationMs: number | null = null;
  let bitRateKbps: number | null = null;
  let title: string | null = null;
  let chapters = 0;
  const pictures: PictureTrack[] = [];
  const sounds: SoundTrack[] = [];
  const captions: CaptionTrack[] = [];
  let cover: CoverPicture | null = null;
  /** Whose metadata the indented "key : value" lines that follow are: the file's, a track's, or nothing kept. */
  let owner: { title: string | null } | 'file' | null = null;
  let seen = false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trimEnd();
    // Only the first file FFmpeg was given ("Input #1" and on are another's).
    if (seen && /^Input #\d+, /u.test(line)) break;
    const input = INPUT.exec(line);
    if (input) {
      seen = true;
      container = input[1] ?? null;
      owner = 'file';
      continue;
    }
    if (!seen) continue;
    const duration = DURATION.exec(line);
    if (duration) {
      if (duration[1] !== undefined)
        durationMs = Math.round(
          ((Number(duration[1]) * 60 + Number(duration[2])) * 60 + Number(duration[3])) * 1000,
        );
      if (duration[4] !== undefined) bitRateKbps = Number(duration[4]);
      owner = null;
      continue;
    }
    const stream = STREAM.exec(line);
    if (stream) {
      const [, language = null, kind, rest = ''] = stream;
      owner = null;
      if (kind === 'Video') {
        const picture = pictureOf(rest, language);
        if (rest.includes('(attached pic)')) {
          cover ??= {
            codecName: COVER_NAMES[picture.codec] ?? picture.codecName,
            width: picture.width,
            height: picture.height,
          };
        } else {
          pictures.push(picture);
          owner = picture;
        }
      } else if (kind === 'Audio') {
        const sound = soundOf(rest, language);
        sounds.push(sound);
        owner = sound;
      } else if (kind === 'Subtitle') {
        const codec = /^([\w-]+)/u.exec(rest)?.[1] ?? '';
        const caption: CaptionTrack = {
          codec,
          codecName: CAPTION_NAMES[codec] ?? codec,
          language: languageName(language),
          title: null,
        };
        captions.push(caption);
        owner = caption;
      }
      continue;
    }
    if (/^\s*Chapter #\d+:\d+/u.test(line)) {
      chapters++;
      owner = null;
      continue;
    }
    if (/^\s*(Program \d+|Side data:|Chapters:)/u.test(line)) {
      owner = null;
      continue;
    }
    const meta = METADATA.exec(line);
    if (!meta || owner === null) continue;
    const key = (meta[1] ?? '').toLowerCase();
    const value = (meta[2] ?? '').trim();
    if (value === '') continue;
    if (owner === 'file') {
      if (key === 'title') title ??= value;
    } else if (key === 'title' || key === 'name') {
      // A track's own name: Matroska's title, QuickTime's name.
      owner.title ??= value;
    }
  }
  return {
    container: containerName(container, ext),
    durationMs,
    bitRateKbps,
    title,
    pictures,
    sounds,
    captions,
    cover,
    chapters,
  };
}
