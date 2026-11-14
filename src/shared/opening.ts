import { z } from 'zod';
import { MEDIA_ID_PATTERN, MEDIA_SCHEME } from './media';
import { cutText } from './text';

/*
 * The opening (Session 55, the owner's brief of 3 Nov 2026; alpha.16, his words of 11 Nov 2026: "2 seconds, one photo,
 * no words, with a smooth transition", and "the mandir's own sound from the opening pack"): two seconds as Drashti
 * starts, in the operator window only, while the window finishes starting underneath it. One photo: the opening pack's
 * photo 1, or one chosen in File › Opening… (Pro Mode); with none, Drashti's default photo (the owner's decision of 5
 * Nov 2026); should even its file be missing, Drashti's own lamp lights, alone. The photo comes in from the dark and
 * zooms gently, settling on the whole photo, and the whole goes smoothly into the window at the end; with reduced
 * motion, or the Appearance window's Interface motion Off, the photo stays still and comes and goes with a plain fade.
 * No words, no light passing over it, no sparkles.
 *
 * The pack's own sound, if its top holds one (sound.mp3, sound.m4a or sound.wav), plays gently with the mandir's
 * photo: at a low volume, faded in and out, and stopped as the two seconds end (a longer file is faded out and
 * stopped). Drashti keeps its own copy of it, as of the photo; it is never played with Drashti's default photo, and
 * Drashti ships none (nothing real goes into the app). Like the photo, it is the operator window's alone: never the
 * hall's screens, a node, the stream or a phone.
 *
 * Only opacity and transform move, each as one Web Animation the compositor plays, and the sound's loudness is set on
 * the audio thread (Web Audio), so the window's own start goes on beside them and never makes either uneven; nothing
 * in it swings in light more than once a second, far under the three a second the screens are held to
 * (shared/flash.ts).
 */

/** The whole opening, in ms (two seconds since alpha.16; five before). */
export const OPENING_MS = 2000;
/**
 * The longest it waits for the hall's screens to draw their first frame before it plays (still, then): it never moves
 * while they are still getting ready, so it never slows them (their warm-up waits for frames that come on time).
 */
export const OPENING_HOLD_MS = 2000;
/**
 * The longest it waits for the operator window underneath to have started (Session 58, C4: Q57-32): opened, its own GPU
 * warm-up over (render/WarmUp.tsx, over by its own 8 s limit from when the window starts under the opening's black)
 * and its frames on time; then it moves as it would. Longer than the screens' wait, as that warm-up takes seconds on a
 * slow GPU (CI's Mac), and the opening's two seconds must never share the GPU with it.
 */
export const OPENING_START_HOLD_MS = 9000;
/** The opening's own copy of its photo is at most this big (it fills the operator window). */
export const OPENING_COPY_WIDTH = 1920;
export const OPENING_COPY_HEIGHT = 1200;
/** A copy's most bytes (a JPEG of that size is far under it). */
export const OPENING_COPY_MAX_BYTES = 4 * 1024 * 1024;

/** When the photo has come in, and when the whole goes into the window (ms from the opening's start). */
export const OPENING_TIMES = {
  /** The photo comes in from the dark over this long. */
  fadeIn: 450,
  /** The whole fades into the window over the last of the two seconds. */
  fadeOut: { start: OPENING_MS - 450, length: 450 },
  end: OPENING_MS,
} as const;

/** The gentle zoom, as before: from this a little closer, settling on the whole photo as the two seconds end. */
export const OPENING_ZOOM = 1.08;

/** The kinds of sound a pack may hold, by its name's ending. */
export const OPENING_SOUND_KINDS = ['mp3', 'm4a', 'wav'] as const;
export type OpeningSoundKind = (typeof OPENING_SOUND_KINDS)[number];

/** The pack's sound, as Drashti keeps it: its copy is opening/<sha256>.<kind> in the media folder. */
export interface OpeningSound {
  sha256: string;
  kind: OpeningSoundKind;
  /** Its name in the pack (sound.m4a), for File › Opening…. */
  name: string;
}

/** A sound's most bytes: a few seconds is plenty, and only its first two play. */
export const OPENING_SOUND_MAX_BYTES = 10 * 1024 * 1024;
/** The loudest it plays (a gain, 0 to 1): gently, well under the file's own loudness. */
export const OPENING_SOUND_VOLUME = 0.25;
/** It fades in over this long from silence, and out over this long to silence (ms). */
const SOUND_IN = 400;
const SOUND_OUT = 600;

/** What is kept with the library's settings ("opening"): the photo (from Media, by id) and the pack's sound. */
export interface OpeningSetting {
  on: boolean;
  /** The opening's photo; null: Drashti's default photo. */
  photo: string | null;
  sound: OpeningSound | null;
}

/** Nothing kept: on, with nothing chosen (the default photo, no sound). */
export const OPENING_DEFAULT: OpeningSetting = { on: true, photo: null, sound: null };

const SHA256 = /^[0-9a-f]{64}$/u;
/** A name as kept: NFC, its spaces made single, trimmed, and at most this long. */
const NAME_MAX = 120;

const mediaIdSchema = z.string().regex(MEDIA_ID_PATTERN);
const soundSchema = z.object({
  sha256: z.string().regex(SHA256),
  kind: z.enum(OPENING_SOUND_KINDS),
  name: z
    .string()
    .transform((n) => cutText(n.normalize('NFC').replace(/\s+/gu, ' ').trim(), NAME_MAX))
    .pipe(z.string().min(1)),
});
const settingSchema = z.object({
  on: z.boolean().optional().catch(undefined),
  photo: z.unknown().optional(),
  /** alpha.15's photos, in order (up to eight): its first is the photo now. */
  photos: z.array(z.unknown()).optional().catch(undefined),
  sound: z.unknown().optional(),
});

/**
 * What is kept, read forgivingly: what it cannot read is left out, never the rest. alpha.15 kept several photos and
 * lines: its first photo is the photo, and its words are no more.
 */
export function readOpening(raw: unknown): OpeningSetting {
  const kept = settingSchema.safeParse(raw);
  if (!kept.success) return OPENING_DEFAULT;
  const photoOf = (p: unknown) => {
    const read = mediaIdSchema.safeParse(p);
    return read.success ? read.data : null;
  };
  // Kept by alpha.16 (null too: taken out); else alpha.15's first photo it can read.
  const photo =
    raw !== null && typeof raw === 'object' && 'photo' in raw
      ? photoOf(kept.data.photo)
      : ((kept.data.photos ?? []).map(photoOf).find((p) => p !== null) ?? null);
  const sound = soundSchema.safeParse(kept.data.sound);
  return { on: kept.data.on ?? true, photo, sound: sound.success ? sound.data : null };
}

/** The photo's copy for the opening (made at the operator window's size, main/opening/opening-files.ts). */
export const openingPhotoUrl = (mediaId: string): string => `${MEDIA_SCHEME}://opening/${mediaId}`;
/** The pack's sound's copy, by its sha256 (so a new sound is never an old one remembered). */
export const openingSoundUrl = (sha256: string): string => `${MEDIA_SCHEME}://opening-sound/${sha256}`;

/** A change from the window, checked whole: the photo, a media id, or null for Drashti's default photo. */
export const openingChoiceSchema = z.object({ photo: mediaIdSchema.nullable() });

export type OpeningChoice = z.infer<typeof openingChoiceSchema>;

/** What the operator window plays. */
export interface OpeningPlan {
  /** The photo's URL; null: the lamp (Drashti's default photo's file missing). */
  photo: string | null;
  /** The pack's sound's URL: with the mandir's own photo only, never with the default photo or the lamp. */
  sound?: string;
  /** The hall's screens are still getting ready: it waits for them (OPENING_HOLD_MS at most) before it moves. */
  hold?: boolean;
  /** Drashti's default photo, nothing being chosen: shown whole, and never with a sound. */
  defaultPhoto?: boolean;
}

/** Drashti's default photo, as the operator window asks for it (main/opening/opening-photo.ts says where it is). */
export const OPENING_DEFAULT_PHOTO_URL = `${MEDIA_SCHEME}://opening-default/photo`;

/**
 * What plays: the mandir's photo (its URL), with the pack's sound when there is one; with no photo (nothing chosen, or
 * the chosen one gone from Media), Drashti's default photo alone and never a sound (the owner, 11 Nov 2026); its file
 * missing (`defaultPhoto` false), the lamp alone.
 */
export function openingPlanOf(
  photo: string | null,
  sound: string | null,
  defaultPhoto: boolean,
): OpeningPlan {
  if (photo !== null) return sound ? { photo, sound } : { photo };
  return defaultPhoto ? { photo: OPENING_DEFAULT_PHOTO_URL, defaultPhoto: true } : { photo: null };
}

/** How it ended, for the log: by itself, or a key, a click or a tap. */
export type OpeningEnd = 'itself' | 'key' | 'click';

/**
 * File › Opening…'s view: the switch; the photo, its name, whether its copy is made and whether it left Media; the
 * pack's sound, if one is kept (its copy there); and whether Drashti's default photo is there (what plays with no
 * photo chosen).
 */
export interface OpeningView {
  on: boolean;
  photo: { mediaId: string; name: string; ready: boolean; gone: boolean } | null;
  sound: { name: string; url: string } | null;
  defaultPhoto: boolean;
}

export type OpeningResult = { ok: true; view: OpeningView } | { ok: false; message: string };

/** A smooth turn from 0 to 1 (a raised cosine): no corner to click at either end. */
const smooth = (x: number): number => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2;

/**
 * The pack's sound's loudness (a gain, 0 to 1) `t` ms into the opening, for a sound that lasts `length` ms (the two
 * seconds, or the file's own length when it is shorter): in from silence, OPENING_SOUND_VOLUME at most, and out to
 * silence at its end; silent before and after. A sound too short for both fades shares its time between them.
 */
export function openingSoundGain(t: number, length: number = OPENING_MS): number {
  const end = Math.max(0, Math.min(OPENING_MS, length));
  if (t <= 0 || t >= end) return 0;
  const share = Math.min(1, end / (SOUND_IN + SOUND_OUT));
  const inMs = SOUND_IN * share;
  const outMs = SOUND_OUT * share;
  return OPENING_SOUND_VOLUME * Math.min(smooth(t / inMs), smooth((end - t) / outMs));
}

/** That loudness at `points` even steps from the start to its end, as Web Audio's setValueCurveAtTime takes it. */
export function openingSoundCurve(length: number = OPENING_MS, points = 101): number[] {
  const end = Math.max(0, Math.min(OPENING_MS, length));
  const n = Math.max(2, points);
  return Array.from({ length: n }, (_, i) => openingSoundGain((i * end) / (n - 1), end));
}

/** The opening pack (the owner's, on the setup day): its folder of photos, of which photo 1 is the opening's. */
export const PACK_PHOTOS = 'photos';
/** A pack's photo 1 may be any of these, in any case. */
export const PACK_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const;
/** Its sound, at its top: sound.mp3, sound.m4a or sound.wav. */
export const PACK_SOUND = 'sound';

const PACK_PHOTO = new RegExp(`^1\\.(${PACK_EXTENSIONS.join('|')})$`, 'iu');
const PACK_SOUND_NAME = new RegExp(`^${PACK_SOUND}\\.(${OPENING_SOUND_KINDS.join('|')})$`, 'iu');

/** The pack's photo 1 among the names in its photos folder (the first by name, should there be two), or null. */
export function packPhotoOf(names: readonly string[]): string | null {
  return [...names].sort().find((n) => PACK_PHOTO.test(n)) ?? null;
}

/** The pack's sound among the names at its top: its name and kind, null for none, or the names when it has several. */
export function packSoundOf(
  names: readonly string[],
): { name: string; kind: OpeningSoundKind } | { several: string[] } | null {
  const found = [...names].sort().filter((n) => PACK_SOUND_NAME.test(n));
  if (found.length > 1) return { several: found };
  const [name] = found;
  const kind =
    name === undefined ? undefined : OPENING_SOUND_KINDS.find((k) => name.toLowerCase().endsWith(`.${k}`));
  return name !== undefined && kind !== undefined ? { name, kind } : null;
}

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** What a pack is missing (its photo 1), in words; null when it has it. */
export function packMissing(found: { photo: boolean }): string | null {
  return found.photo ? null : `The opening pack has no photo 1 (${PACK_PHOTOS}/1.jpg). Nothing was changed.`;
}

/** A pack with more than one sound, in words. */
export const packSoundsMessage = (names: readonly string[]): string =>
  `The opening pack has more than one sound (${list(names)}): keep one of them. Nothing was changed.`;

/**
 * Why the pack's sound cannot be the opening's, in words (import/probe.ts read what it is from its bytes), or null:
 * a sound Drashti plays, at most OPENING_SOUND_MAX_BYTES.
 */
export function packSoundProblem(sound: {
  name: string;
  bytes: number;
  kind: 'image' | 'video' | 'audio' | 'unknown';
  playable: boolean | null;
  format: string;
}): string | null {
  if (sound.bytes > OPENING_SOUND_MAX_BYTES)
    return `The opening pack’s ${sound.name} is too big: the opening’s sound can be at most ${String(
      OPENING_SOUND_MAX_BYTES / 1024 / 1024,
    )} MB, and only its first two seconds play. Nothing was changed.`;
  const format = sound.bytes === 0 ? 'empty file' : sound.format;
  if (sound.bytes === 0 || sound.kind !== 'audio' || sound.playable !== true)
    return `Drashti cannot play the opening pack’s ${sound.name} as it is: ${format}. Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.`;
  return null;
}
