import { z } from 'zod';

/** Edit Video… recipes are source-time values; every prepared showing has its own immutable media ID. */
export interface VideoEditRecipe {
  version: 1;
  trim: { startMs: number | null; endMs: number | null };
  picture: {
    crop: { x: number; y: number; w: number; h: number };
    zoom: number;
    x: number;
    y: number;
    turn: 0 | 90 | 180 | 270;
    flipX: boolean;
    flipY: boolean;
    fill: boolean;
    brightness: number;
    contrast: number;
    colour: number;
  };
  fades: { pictureInMs: number; pictureOutMs: number; soundInMs: number; soundOutMs: number };
  speed: number;
  /** Zero-based audio-stream ordinal, not the container's absolute stream number; null: default first track. */
  audioTrack: number | null;
  noiseReduction: boolean;
  thumbnailMs: number | null;
}

export const PLAIN_VIDEO_EDIT: VideoEditRecipe = {
  version: 1,
  trim: { startMs: null, endMs: null },
  picture: {
    crop: { x: 0, y: 0, w: 1, h: 1 },
    zoom: 1,
    x: 0,
    y: 0,
    turn: 0,
    flipX: false,
    flipY: false,
    fill: false,
    brightness: 0,
    contrast: 0,
    colour: 0,
  },
  fades: { pictureInMs: 0, pictureOutMs: 0, soundInMs: 0, soundOutMs: 0 },
  speed: 1,
  audioTrack: null,
  noiseReduction: false,
  thumbnailMs: null,
};

const time = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600 * 1000);
const unit = z.number().min(0).max(1);
const crop = z
  .object({ x: unit, y: unit, w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) })
  .strict()
  .refine((c) => c.x + c.w <= 1.000001 && c.y + c.h <= 1.000001);
const fade = z.number().int().min(0).max(60000);
export const videoEditRecipeSchema: z.ZodType<VideoEditRecipe> = z
  .object({
    version: z.literal(1),
    trim: z
      .object({ startMs: time.nullable(), endMs: time.nullable() })
      .strict()
      .refine((t) => t.endMs === null || t.endMs > (t.startMs ?? 0)),
    picture: z
      .object({
        crop,
        zoom: z.number().min(1).max(4),
        x: z.number().min(-1.5).max(1.5),
        y: z.number().min(-1.5).max(1.5),
        turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        flipX: z.boolean(),
        flipY: z.boolean(),
        fill: z.boolean(),
        brightness: z.number().min(-0.5).max(0.5),
        contrast: z.number().min(-0.5).max(0.5),
        colour: z.number().min(-1).max(1),
      })
      .strict(),
    fades: z.object({ pictureInMs: fade, pictureOutMs: fade, soundInMs: fade, soundOutMs: fade }).strict(),
    speed: z.number().min(0.5).max(2),
    audioTrack: z.number().int().min(0).max(255).nullable(),
    noiseReduction: z.boolean(),
    thumbnailMs: time.nullable(),
  })
  .strict();

/** Source time, in m:ss[.mmm] or h:mm:ss[.mmm]; never frame numbers guessed from a nominal frame rate. */
export function parseVideoEditTime(text: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/u.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  if (match[1] !== undefined && minutes > 59) return null;
  const ms =
    ((hours * 60 + minutes) * 60 + Number(match[3])) * 1000 + Number((match[4] ?? '').padEnd(3, '0'));
  return ms <= 24 * 3600 * 1000 ? ms : null;
}

/** A thumbnail does not affect the playing file. Every requested picture/sound/timing change is prepared once. */
export function videoEditNeedsCopy(r: VideoEditRecipe): boolean {
  const p = r.picture;
  return (
    (r.trim.startMs ?? 0) !== 0 ||
    r.trim.endMs !== null ||
    r.speed !== 1 ||
    r.audioTrack !== null ||
    r.noiseReduction ||
    p.zoom !== 1 ||
    p.x !== 0 ||
    p.y !== 0 ||
    p.turn !== 0 ||
    p.flipX ||
    p.flipY ||
    p.fill ||
    p.brightness !== 0 ||
    p.contrast !== 0 ||
    p.colour !== 0 ||
    p.crop.x !== 0 ||
    p.crop.y !== 0 ||
    p.crop.w !== 1 ||
    p.crop.h !== 1 ||
    Object.values(r.fades).some((v) => v !== 0)
  );
}

export function videoEditTime(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const seconds = Math.floor(whole / 1000);
  const fraction = whole % 1000;
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`;
}

export interface VideoEditSnapshot {
  mediaId: string;
  revision: number;
  recipe: VideoEditRecipe;
  state: 'ready' | 'preparing' | 'failed';
  readyMediaId: string | null;
  message: string | null;
}

export type VideoEditResult = { ok: true; edit: VideoEditSnapshot } | { ok: false; message: string };
export interface SaveVideoEdit {
  mediaId: string;
  revision: number;
  recipe: VideoEditRecipe;
}
export const saveVideoEditSchema: z.ZodType<SaveVideoEdit> = z
  .object({
    mediaId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    recipe: videoEditRecipeSchema,
  })
  .strict();
