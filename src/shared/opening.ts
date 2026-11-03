import { z } from 'zod';
import { animationById, cutIntoUnits, type LinePiece } from './lower-third-animations';
import { fontChoice } from './lower-third-fonts';
import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from './media';
import { cutText } from './text';

/*
 * The opening (Session 55, the owner's brief and addition of 3 Nov 2026): five seconds as Drashti starts, in the
 * operator window only, while the window finishes starting underneath it. The mandir's own photos (up to eight) and
 * lines of words (up to five), chosen in File › Opening… (Pro Mode): the photos share the five seconds, and so, side
 * by side, do the lines (five of each: each photo with its own line, a second each; the owner's pack of 4 Nov, eight
 * photos and five lines: a photo every 625 ms under a line a second). Each photo comes in over the one before and
 * slowly zooms, a soft light sweeps across it once, a few sparkles glint, and each line comes in word by word with one
 * of the Lower Thirds studio's moves, in the studio's Noto Serif (its Gujarati and Devanagari faces). With no photo,
 * Drashti's own lamp lights, its lines (or Drashti's name) after it. With reduced motion, or the Appearance window's
 * Interface motion Off, the first photo stays still and the lines fade in, one after another.
 *
 * Only opacity and transform move, each as one Web Animation the compositor plays, so the window's own start goes on
 * beside it; and nothing in it swings in light more than once a second, far under the three a second the screens are
 * held to (shared/flash.ts). Drashti ships no photos and no words for it: the opening pack the owner gives each
 * mandir (photos/1.jpg to 8.jpg and words.txt) is loaded on the setup day.
 */

/** The whole opening, in ms. */
export const OPENING_MS = 5000;
/** At most this many photos, and this many lines. */
export const OPENING_PHOTOS_MAX = 8;
export const OPENING_LINES_MAX = 5;
/** A line's most UTF-16 units (cut between letters, never inside a conjunct). */
export const OPENING_LINE_MAX = 120;
/** The Lower Thirds studio's move the words come in with: "Rise word by word, quick". */
export const OPENING_WORDS = 'word-rise-band-fade-quick';
/** The studio's font the words are drawn in, with its Gujarati and Devanagari faces, bold. */
export const OPENING_FONT = fontChoice('Noto Serif');
export const OPENING_WEIGHT = 700;
/** The opening's own copy of each photo is at most this big (it fills the operator window, 5 s). */
export const OPENING_COPY_WIDTH = 1920;
export const OPENING_COPY_HEIGHT = 1200;
/** A copy's most bytes (a JPEG of that size is far under it). */
export const OPENING_COPY_MAX_BYTES = 4 * 1024 * 1024;

/** What is kept with the library's settings ("opening"): the photos (from Media, by id) and the lines, in order. */
export interface OpeningSetting {
  on: boolean;
  photos: string[];
  lines: string[];
}

/** Nothing kept: on, with nothing chosen (the lamp). */
export const OPENING_DEFAULT: OpeningSetting = { on: true, photos: [], lines: [] };

/** A line as kept: its spaces made single, trimmed, NFC, and cut to the limit between letters. */
export const cleanLine = (line: string): string =>
  cutText(line.normalize('NFC').replace(/\s+/gu, ' ').trim(), OPENING_LINE_MAX).trim();

const mediaIdSchema = z.string().regex(MEDIA_ID_PATTERN);
const listSchema = z.array(z.unknown()).optional().catch(undefined);
const settingSchema = z.object({ on: z.boolean().optional().catch(undefined), photos: listSchema, lines: listSchema });

/** What is kept, read forgivingly: a photo or a line it cannot read is left out, never the rest. */
export function readOpening(raw: unknown): OpeningSetting {
  const kept = settingSchema.safeParse(raw);
  if (!kept.success) return OPENING_DEFAULT;
  const photos = (kept.data.photos ?? []).flatMap((p) => {
    const read = mediaIdSchema.safeParse(p);
    return read.success ? [read.data] : [];
  });
  const lines = (kept.data.lines ?? []).flatMap((l) => {
    const line = typeof l === 'string' ? cleanLine(l) : '';
    return line === '' ? [] : [line];
  });
  return {
    on: kept.data.on ?? true,
    photos: photos.slice(0, OPENING_PHOTOS_MAX),
    lines: lines.slice(0, OPENING_LINES_MAX),
  };
}

/** A photo's copy for the opening (made at the operator window's size, main/opening/opening-files.ts). */
export const openingPhotoUrl = (mediaId: string): string => `${MEDIA_SCHEME}://opening/${mediaId}`;

/** A change from the window, checked whole: every photo a media id, at most eight; at most five lines. */
export const openingChoiceSchema = z.object({
  photos: z.array(mediaIdSchema).max(OPENING_PHOTOS_MAX),
  lines: z.array(z.string()).max(OPENING_LINES_MAX),
});

export type OpeningChoice = z.infer<typeof openingChoiceSchema>;

/** What the operator window plays: the photos (their URLs) and the lines. No photo: the lamp. */
export interface OpeningPlan {
  photos: string[];
  lines: string[];
}

/** How it ended, for the log: by itself, or a key, a click or a tap. */
export type OpeningEnd = 'itself' | 'key' | 'click';

/** File › Opening…'s view: the switch; each photo, its name, whether its copy is made and whether it left Media. */
export interface OpeningView {
  on: boolean;
  photos: { mediaId: string; name: string; ready: boolean; gone: boolean }[];
  lines: string[];
}

export type OpeningResult = { ok: true; view: OpeningView } | { ok: false; message: string };

/** One photo's place in the five seconds (ms from the opening's start). */
export interface PhotoTimes {
  /** It starts coming in, over the one before (the first from the dark), taking `fadeIn`. */
  start: number;
  fadeIn: number;
  /** The next starts coming in over it, or the opening ends. */
  end: number;
  /** Its light, once across. */
  sweep: { start: number; length: number };
}

/** One line's place in the five seconds. */
export interface LineTimes {
  start: number;
  end: number;
  /** Its first word, the time between words, and each word's own move. */
  words: { start: number; stagger: number; each: number };
  /** It starts going (LINE_OUT ms) just before the next comes; the last goes with the opening. */
  lineOut: number | null;
}

export interface OpeningTimes {
  photos: PhotoTimes[];
  lines: LineTimes[];
  /** With no photo: when the lamp is lit, and its lines (or Drashti's name) start coming in. */
  lampWords: number;
  /** The whole opening fades out at its end. */
  fadeOut: { start: number; length: number };
  end: number;
}

const FIRST_FADE = 450;
const FADE = 320;
const SWEEP = 800;
const WORDS_LEAD = 140;
const LINE_OUT = 160;
const FADE_OUT = 350;
/** All of a line is in by this share of its time, so it is read whole for a while. */
const WORDS_BY = 0.6;

/** With no photo, the lamp is lit by then (app.css, --dur-light), and its lines start. */
const LAMP_WORDS = 1000;

/**
 * The five seconds shared by the photos and, side by side, by the lines (given how many words each has). Each photo
 * has the same time, its light inside it; each line has the same time, all its words in by WORDS_BY of it. With no
 * photo the lamp lights first, and the lines share what is left.
 */
export function openingTimes(photos: number, words: readonly number[]): OpeningTimes {
  const studio = animationById(OPENING_WORDS).timing;
  const each = studio.each ?? 192;
  const stagger = studio.stagger ?? 66;
  const fadeOut = { start: OPENING_MS - FADE_OUT, length: FADE_OUT };
  const slots = (n: number, from: number) => {
    const length = n === 0 ? 0 : Math.floor((OPENING_MS - from) / n);
    return Array.from({ length: n }, (_, i) => ({
      start: from + i * length,
      end: i === n - 1 ? OPENING_MS : from + (i + 1) * length,
      length,
    }));
  };
  const photoTimes = slots(photos, 0).map(({ start, end, length }, i): PhotoTimes => {
    const fadeIn = i === 0 ? FIRST_FADE : Math.min(FADE, Math.round(length * 0.35));
    const sweep = start + Math.round(fadeIn * 0.4);
    return {
      start,
      fadeIn,
      end,
      // Across before the next photo comes.
      sweep: { start: sweep, length: Math.min(SWEEP, Math.round(length * 0.8), end - sweep - 20) },
    };
  });
  const lineTimes = slots(words.length, photos === 0 ? LAMP_WORDS : 0).map(
    ({ start, end, length }, i): LineTimes => {
      const units = words[i] ?? 1;
      const lead = Math.min(WORDS_LEAD, Math.round(length * 0.14));
      // A long line comes in faster, so its last word is in by WORDS_BY of its time.
      const room = length * WORDS_BY - lead - each;
      const gap = units > 1 ? Math.max(20, Math.min(stagger, Math.floor(room / (units - 1)))) : stagger;
      return {
        start,
        end,
        words: { start: start + lead, stagger: gap, each },
        lineOut: i === words.length - 1 ? null : end - LINE_OUT - 40,
      };
    },
  );
  return { photos: photoTimes, lines: lineTimes, lampWords: LAMP_WORDS, fadeOut, end: OPENING_MS };
}

/** A line cut into its words (the studio's own cutting: a conjunct is never split). */
export function cutLine(line: string): { pieces: LinePiece[]; units: number } {
  const { pieces, units } = cutIntoUnits([line], animationById(OPENING_WORDS));
  return { pieces: pieces[0] ?? [], units };
}

/** One word's move as keyframes: the studio move's own poses, sampled (its easing is in them). */
export function wordFrames(i: number): { offset: number; opacity: number; transform: string }[] {
  const a = animationById(OPENING_WORDS);
  return Array.from({ length: 11 }, (_, k) => {
    const p = k / 10;
    const pose = a.pose(p, i);
    return { offset: p, opacity: pose.opacity, transform: pose.transform === '' ? 'none' : pose.transform };
  });
}

/** A sparkle: where (percent of the picture), how big (px), when it glints and for how long (ms). */
export interface Sparkle {
  x: number;
  y: number;
  size: number;
  start: number;
  length: number;
}

const SPARKLES = 10;

/**
 * The sparkles: a few small glints over the photos, each once, one starting at most every 340 ms, the last done
 * before the opening fades out. Always the same (a fixed seed), so no start differs from the last.
 */
export function openingSparkles(): Sparkle[] {
  let seed = 0x5eed1e55;
  const next = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const latest = OPENING_MS - FADE_OUT;
  return Array.from({ length: SPARKLES }, (_, i): Sparkle => {
    const start = 300 + i * 390 + Math.round(next() * 50);
    return {
      x: Math.round(6 + next() * 88),
      y: Math.round(8 + next() * 56),
      size: Math.round(5 + next() * 6),
      start,
      length: Math.max(800, Math.min(Math.round(900 + next() * 400), latest - start)),
    };
  });
}

/** The opening pack (the owner's, on the setup day): its folder of photos, and its lines' file. */
export const PACK_PHOTOS = 'photos';
export const PACK_WORDS = 'words.txt';
/** A pack's photo n (1 to 8) may be any of these. */
export const PACK_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;

/** A pack's lines: one to a line, without a BOM or empty lines, NFC. */
export function packLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n|\r/u)
    .map((line) => line.normalize('NFC').trim())
    .filter((line) => line !== '');
}

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** What a pack is missing (its photos 1 to 8, its five lines), in words; null when it has everything. */
export function packMissing(found: { photos: readonly number[]; lines: number }): string | null {
  const missing = Array.from({ length: OPENING_PHOTOS_MAX }, (_, i) => i + 1).filter(
    (n) => !found.photos.includes(n),
  );
  const short = found.lines < OPENING_LINES_MAX;
  if (missing.length === 0 && !short) return null;
  const photos =
    missing.length === 0
      ? ''
      : `is missing ${missing.length === 1 ? 'photo' : 'photos'} ${list(missing.map(String))} (${list(
          missing.map((n) => `${PACK_PHOTOS}/${String(n)}.jpg`),
        )})`;
  const lines = !short
    ? ''
    : found.lines === 0
      ? `has no lines in ${PACK_WORDS}`
      : `has ${String(found.lines)} ${found.lines === 1 ? 'line' : 'lines'} of the ${String(OPENING_LINES_MAX)} in ${PACK_WORDS}`;
  return `The opening pack ${[photos, lines].filter((s) => s !== '').join(', and ')}. Nothing was changed.`;
}
