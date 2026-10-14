import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * A video's part between its start and end, saved as an MP4 of its own
 * (Session 26e; main/convert/trim.ts): its streams copied as they are, from
 * the keyframe at or before the start. It runs as converting does: in the
 * background, waiting while on air or recording, keeping 2 GB free, shown in
 * the status bar with Stop.
 */

export interface SaveJob {
  id: string;
  /** The media item it is cut from. */
  mediaId: string;
  /** The file it saves, by name. */
  name: string;
  state: 'waiting' | 'saving' | 'done' | 'failed' | 'stopped';
  /** How far it is (0 to 1), or null when it cannot be told. */
  progress: number | null;
  /** Why it waits (the stream on air or recording), or null. */
  note: string | null;
  /** Why it failed, or null. */
  message: string | null;
  /** Where it was saved, once done. */
  path: string | null;
  /** Added to the library too, once done. */
  added: boolean;
}

/** Save the part from `startMs` (null: the beginning) to `endMs` (null: the end). */
export interface SaveRequest {
  mediaId: string;
  startMs: number | null;
  endMs: number | null;
  /** The saved file goes into the library too (off to begin with). */
  addToLibrary: boolean;
}

const time = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600 * 1000);

export const saveRequestSchema: z.ZodType<SaveRequest> = z.object({
  mediaId: idSchema,
  startMs: time.nullable(),
  endMs: time.nullable(),
  addToLibrary: z.boolean(),
});

/** The keyframe a part saved from a start begins at (ms), or why it cannot be told. */
export type KeyframeResult = { ok: true; atMs: number } | { ok: false; message: string };

/** The save started (null: the operator closed the save dialog), or why it cannot be. */
export type SaveResult = { ok: true; job: SaveJob | null } | { ok: false; message: string };
