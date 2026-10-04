import { idSchema } from './model-schema';
import { passageIdSchema } from './shastra';
import { z } from 'zod';

/*
 * Playlists as the operator window sees and edits them (PLAN.md 4.3:
 * Playlist -> PlaylistItem, a presentation, media, a header or a
 * placeholder). Folders hold playlists and other folders.
 */

export interface PlaylistNode {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  /** Items (for a playlist) that are not removed. */
  itemCount: number;
  /** Of those, items the import could not find. */
  placeholders: number;
  /** Came from an import (importing the same file again replaces it). */
  imported: boolean;
  /** A sabha template: a running order to make playlists from, never run itself. */
  template: boolean;
}

/** The order a playlist item plays its presentation in. */
export type ItemOrder =
  /** The presentation's own choice. */
  | { mode: 'presentation' }
  /** Every slide in order. */
  | { mode: 'all' }
  | { mode: 'arrangement'; arrangementId: string };

/**
 * What a playlist item does to a timer when it goes up (Session 12): start
 * it from the beginning, reset it, or show it on the audience screens (as a
 * message with its name and time). The pravachan item, for example, starts
 * a 30-minute countdown, which the stage screens show while it runs.
 */
export interface TimerCue {
  timerId: string;
  action: 'start' | 'reset' | 'show';
}

export const TIMER_CUE_ACTIONS = ['start', 'reset', 'show'] as const satisfies readonly TimerCue['action'][];

export const TIMER_CUE_NAMES: Record<TimerCue['action'], string> = {
  start: 'Start it from the beginning',
  reset: 'Reset it',
  show: 'Show it on the audience screens',
};

/** The most timer cues an item has. */
export const MAX_TIMER_CUES = 4;

export type PlaylistItemInfo =
  | {
      id: string;
      kind: 'presentation';
      label: string;
      presentationId: string;
      /** Null when the presentation has been removed from the library. */
      presentationName: string | null;
      order: ItemOrder;
      /** The named arrangement's name, when the order names one. */
      arrangementName: string | null;
      /** What it does to timers when it goes up. */
      timers: TimerCue[];
    }
  | {
      id: string;
      kind: 'media';
      label: string;
      mediaId: string;
      media: 'image' | 'video' | 'audio';
      /** The file was not found at import. */
      missing: boolean;
      /** What the file is, when Drashti cannot play it. */
      unplayable: string | null;
      timers: TimerCue[];
    }
  | { id: string; kind: 'header'; label: string; color: string | null }
  /**
   * A place for a presentation: a slot from a template (with the category
   * its search starts at, if any), or something the import could not find
   * (with a hint: the file it named). Fill it by choosing or dropping one.
   */
  | { id: string; kind: 'placeholder'; label: string; hint: string | null; category: string | null }
  /**
   * A Shastra passage (Session 12), named by keys so it lasts when its text
   * is loaded again: `missing` while no loaded text has it. Its label is
   * the reference as it read when it was added.
   */
  | { id: string; kind: 'shastra'; label: string; passageId: string; missing: boolean; timers: TimerCue[] };

/** What can be added to a playlist. */
export type NewItem =
  | { kind: 'presentation'; presentationId: string }
  | { kind: 'media'; mediaId: string }
  | { kind: 'header'; label: string }
  | { kind: 'shastra'; passageId: string };

/** A slot that asks for a Shastra passage (filling it opens the Shastra tab). */
export const SHASTRA_SLOT = 'Shastra';

/** A media item as the library's media list shows it. */
export interface MediaSummary {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  missing: boolean;
  /** What it is, when Drashti cannot play it (ProRes, HEIC...); null otherwise. */
  unplayable: string | null;
  /** What it is, as found at import (null: not known). */
  format: string | null;
  /** Converted for Drashti: the name of the copy everything now uses (null: not converted). */
  convertedTo: string | null;
}

export type PlaylistResult = { ok: true; ids: string[] } | { ok: false; message: string };

/** Saving a playlist as a template: its name, and which items become slots (filled each week). */
export interface TemplateRequest {
  name: string;
  /** Items of the playlist that become slots; the rest stay as they are. */
  slots: string[];
}

// ---- checks for requests arriving over IPC ----------------------------------------

// An id, or a Shastra passage's (which can be longer).
const id = idSchema;
export const playlistIdSchema = id;
export const idListSchema = z.array(id).min(1).max(1000);
export const playlistNameSchema = z.string().trim().min(1).max(200);
export const newItemsSchema: z.ZodType<NewItem[]> = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('presentation'), presentationId: id }).strict(),
      z.object({ kind: z.literal('media'), mediaId: id }).strict(),
      z.object({ kind: z.literal('header'), label: z.string().trim().min(1).max(200) }).strict(),
      z.object({ kind: z.literal('shastra'), passageId: passageIdSchema }).strict(),
    ]),
  )
  .min(1)
  .max(500);
export const positionSchema = z.number().int().min(0).max(100_000);
export const templateRequestSchema: z.ZodType<TemplateRequest> = z
  .object({ name: z.string().trim().min(1).max(200), slots: z.array(id).max(1000) })
  .strict();
export const timerCuesSchema: z.ZodType<TimerCue[]> = z
  .array(z.object({ timerId: id, action: z.enum(TIMER_CUE_ACTIONS) }).strict())
  .max(MAX_TIMER_CUES);

export const slotSchema = z
  .object({ label: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(60).nullable() })
  .strict();
export const itemOrderSchema: z.ZodType<ItemOrder> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('presentation') }).strict(),
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('arrangement'), arrangementId: id }).strict(),
]);
