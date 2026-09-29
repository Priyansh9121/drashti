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
}

/** The order a playlist item plays its presentation in. */
export type ItemOrder =
  /** The presentation's own choice. */
  | { mode: 'presentation' }
  /** Every slide in order. */
  | { mode: 'all' }
  | { mode: 'arrangement'; arrangementId: string };

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
    }
  | { id: string; kind: 'header'; label: string; color: string | null }
  /** Something the import could not find: a presentation can be dropped on it. */
  | { id: string; kind: 'placeholder'; label: string; hint: string | null };

/** What can be added to a playlist. */
export type NewItem =
  | { kind: 'presentation'; presentationId: string }
  | { kind: 'media'; mediaId: string }
  | { kind: 'header'; label: string };

/** A media item as the library's media list shows it. */
export interface MediaSummary {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  missing: boolean;
  unplayable: string | null;
}

export type PlaylistResult = { ok: true; ids: string[] } | { ok: false; message: string };

// ---- checks for requests arriving over IPC ----------------------------------------

const id = z.string().min(1).max(128);
export const playlistIdSchema = id;
export const idListSchema = z.array(id).min(1).max(1000);
export const playlistNameSchema = z.string().trim().min(1).max(200);
export const newItemsSchema: z.ZodType<NewItem[]> = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('presentation'), presentationId: id }).strict(),
      z.object({ kind: z.literal('media'), mediaId: id }).strict(),
      z.object({ kind: z.literal('header'), label: z.string().trim().min(1).max(200) }).strict(),
    ]),
  )
  .min(1)
  .max(500);
export const positionSchema = z.number().int().min(0).max(100_000);
export const itemOrderSchema: z.ZodType<ItemOrder> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('presentation') }).strict(),
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('arrangement'), arrangementId: id }).strict(),
]);
