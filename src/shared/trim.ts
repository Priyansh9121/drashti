import { z } from 'zod';
import { mediaMarkersInputSchema } from './markers';
import { VIDEO_EXTENSIONS } from './media';
import type { MediaMarkers } from './markers';
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

/** The original video and the playlist row's cut, both in the original's time. */
export interface RowTrimView {
  itemId: string;
  mediaId: string;
  sourceId: string;
  sourceName: string;
  canReset: boolean;
  markers: MediaMarkers;
}

export interface RowTrimRequest {
  /** The video still expected in the row when it is saved. */
  mediaId: string;
  points: MediaMarkers;
}

export const rowTrimRequestSchema: z.ZodType<RowTrimRequest> = z.object({
  mediaId: idSchema,
  points: mediaMarkersInputSchema,
});

export type RowTrimResult = { ok: true } | { ok: false; message: string };

/*
 * How a row's cut stands while the row says Preparing (alpha.22, the owner's "Trim on a row": nothing said why it
 * waited): why it waits, in the operator's words (shared/save-waits.ts, or that the row's own video is up), or how far
 * it is (0 to 1). Both null: it waits its turn behind another video being made.
 */
export interface TrimRowStatus {
  note: string | null;
  progress: number | null;
}

/** Each row's cut that says how it stands, by the row. */
export type TrimStatuses = Record<string, TrimRowStatus>;

export const TRIM_TURN = 'Waiting: another video is being made first';
export const TRIM_ROW_UP = 'Ready: it takes the row’s place once the row’s video comes off';

/** What a row says of its cut under Preparing, or null for nothing (not yet queued). */
export function trimStatusWords(status: TrimRowStatus | undefined): string | null {
  if (!status) return null;
  if (status.note !== null) return status.note;
  if (status.progress !== null)
    return `Saving the trimmed video: ${String(Math.round(Math.min(1, Math.max(0, status.progress)) * 100))}%`;
  return TRIM_TURN;
}

/**
 * The name a row's trimmed video takes in Media, without its extension (alpha.22; main/convert/trim-copy.ts, the
 * name its Trim dialog says before Save trimmed video): the original's, less a video's extension, and "trimmed". A
 * dot that is part of the name stays ("Placeholder v1.2 trimmed"; the save-trim review's nit). Main makes it safe on
 * both systems first, and a number goes after it when that name is taken.
 */
export function trimmedTitle(name: string): string {
  // Everything before the last dot (at least one character), and what follows it.
  const parts = /^(.+)\.([^.]+)$/su.exec(name);
  const stem = parts?.[1];
  const extension = parts?.[2]?.toLowerCase();
  const title =
    stem !== undefined && extension !== undefined && VIDEO_EXTENSIONS.includes(extension) ? stem : name;
  return `${title} trimmed`;
}

/** The notice once a row's trimmed video is made (alpha.22). */
export const trimSavedNotice = (name: string): string =>
  `“${name}” is in Media. Its playlist row plays it from now on.`;
