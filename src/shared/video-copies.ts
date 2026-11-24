import { z } from 'zod';
import { idSchema } from './model-schema';
export interface VideoProxy {
  mediaId: string;
  state: 'checking' | 'waiting' | 'preparing' | 'ready' | 'not-needed' | 'failed' | 'stopped';
  required: boolean;
  readyMediaId: string | null;
  progress: number | null;
  width: number | null;
  height: number | null;
  note: string | null;
  message: string | null;
}
export type VideoProxyResult = { ok: true; proxy: VideoProxy } | { ok: false; message: string };
export interface ClipExportRequest {
  mediaId: string;
  startMs: number;
  endMs: number;
  frame: 'original' | 'edited';
  shape: 'source' | 'vertical';
  container: 'mp4' | 'webm';
  addToLibrary: boolean;
  /** An edited export must match the editor's saved revision. */
  revision: number | null;
}
const ms = z.number().int().min(0).max(86_400_000);
export const clipExportRequestSchema: z.ZodType<ClipExportRequest> = z
  .object({
    mediaId: idSchema,
    startMs: ms,
    endMs: ms,
    frame: z.enum(['original', 'edited']),
    shape: z.enum(['source', 'vertical']),
    container: z.enum(['mp4', 'webm']),
    addToLibrary: z.boolean(),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict()
  .refine((r) => r.endMs > r.startMs);
export interface ClipExportJob {
  id: string;
  mediaId: string;
  name: string;
  state: 'waiting' | 'preparing' | 'done' | 'failed' | 'stopped';
  progress: number | null;
  note: string | null;
  message: string | null;
  path: string | null;
  added: boolean;
}
export type ClipExportResult = { ok: true; job: ClipExportJob | null } | { ok: false; message: string };

/*
 * Combine videos… (alpha.22; the owner, 24 Nov 2026: "new feature, combine 2 videos", "Yes, one after other"): two or
 * more videos in Media, in the operator's order, made into ONE new video that plays them one after the other, added to
 * Media. The originals are never changed. Pro Mode's.
 */
/** The most videos one combine takes. */
export const COMBINE_MOST = 10;
/**
 * What goes between them (the owner, 24 Nov 2026: "transition between 2 merged videos"): Dissolve (picture and sound
 * cross over), Fade through black (the sound dipping), or Cut (none); the same at every join.
 */
export type CombineTransition = 'dissolve' | 'fade-black' | 'cut';
/** A transition's length: 0.5 to 3 s, 1 s unless chosen. */
export const COMBINE_TRANSITION_MS = { least: 500, most: 3000, usual: 1000 } as const;
export interface CombineRequest {
  /** The videos, in the order they play. */
  mediaIds: string[];
  transition: CombineTransition;
  transitionMs: number;
  /** Also save a copy to a file chosen in the system's save dialog, before it combines. */
  saveCopy: boolean;
}
export const combineRequestSchema: z.ZodType<CombineRequest> = z
  .object({
    mediaIds: z.array(idSchema).min(2).max(COMBINE_MOST),
    transition: z.enum(['dissolve', 'fade-black', 'cut']),
    transitionMs: z.number().int().min(COMBINE_TRANSITION_MS.least).max(COMBINE_TRANSITION_MS.most),
    saveCopy: z.boolean(),
  })
  .strict()
  .refine((r) => new Set(r.mediaIds).size === r.mediaIds.length);
export interface CombineJob {
  id: string;
  /** The new video's name in Media. */
  name: string;
  mediaIds: string[];
  transition: CombineTransition;
  transitionMs: number;
  /** The videos too short for the transition, by name: each joined with a plain cut. */
  short: string[];
  state: 'waiting' | 'preparing' | 'done' | 'failed' | 'stopped';
  progress: null | number;
  note: string | null;
  message: string | null;
  /** The new video in Media, once it is there. */
  mediaId: string | null;
  /** The file a copy was saved to (Also save a copy to a file), once it is there. */
  savedTo: string | null;
}
/** A combine queued (null: the save dialog of Also save a copy to a file was cancelled, so none), or why not. */
export type CombineResult = { ok: true; job: CombineJob | null } | { ok: false; message: string };
