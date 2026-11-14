import { idSchema } from './model-schema';
import { cleanNameSchema } from './rename-name';
import type { RepeatSettings } from './repeat';
import { passageIdSchema } from './shastra';
import { VIDEO_INPUT_NAME_MAX } from './video-inputs';
import type { WhenEnds } from './wallpapers';
import { z } from 'zod';

/*
 * Playlists as the operator window sees and edits them (PLAN.md 4.3:
 * Playlist -> PlaylistItem, a presentation, media, a header or a
 * placeholder; a Shastra passage since Session 12, a video input since Session 51). Folders hold playlists and
 * other folders.
 */

/**
 * What a playlist is (migration 38): one the operator builds ('normal'), one that follows a folder on the
 * computer ('smart', Session 26c), or one that goes round its slides by itself ('repeat', Session 26d).
 */
export type PlaylistKind = 'normal' | 'smart' | 'repeat';

/** The most files a smart playlist follows (Session 26c): past that, it says so and adds nothing more. */
export const SMART_MAX_FILES = 2000;

/**
 * Files and folders dropped on Drashti (Session 56, the owner's words of 11 Nov 2026, item 5: "A folder dragged in is
 * added straight away, with no questions … it becomes a smart playlist that follows that folder"): the smart playlists
 * made, one for each folder, in the order dropped; the rest (files, a Keynote package, a folder holding only lyrics or
 * the other program's files) for the drop's own place, as before; and what went wrong, in words.
 */
export interface SmartFromDrop {
  made: string[];
  files: string[];
  problems: string[];
}

/** A smart playlist as the window shows it (Session 26c): the folder it follows, and how the following goes. */
export interface SmartPlaylistView {
  playlistId: string;
  /** The folder it follows, on this computer. */
  folder: string;
  /**
   * 'following': all is well. 'folder-gone': the folder is not there (a USB stick taken out); the playlist
   * keeps its items and carries on when it is back. 'too-many': the folder holds more than SMART_MAX_FILES
   * files Drashti takes; nothing more is added or marked until some go. 'waiting' (Session 28): files that
   * held still wait while the stream is on air or recording, and join afterwards.
   */
  state: 'following' | 'folder-gone' | 'too-many' | 'waiting';
  /** New or changed files waiting for their size to hold still, or being imported. */
  adding: number;
  /** Items whose files are gone from the folder (marked, not removed). */
  missing: number;
}

export interface PlaylistNode {
  id: string;
  name: string;
  isFolder: boolean;
  /** Its kind (a folder is always 'normal'). */
  kind: PlaylistKind;
  /** A Repeat Slides playlist's settings (Session 26d); left out for any other kind. */
  repeat?: RepeatSettings;
  parentId: string | null;
  /** Items (for a playlist) that are not removed. */
  itemCount: number;
  /** Of those, items the import could not find. */
  placeholders: number;
  /** Came from an import (importing the same file again replaces it). */
  imported: boolean;
  /** A sabha template: a running order to make playlists from, never run itself. */
  template: boolean;
  /**
   * Made from a folder (Session 44): a smart playlist, a Dropbox folder link's, or one an earlier version made
   * from a link. The operator window shows it a folder at a time (shared/playlist-folders.ts).
   */
  fromFolder?: true;
  /** Shared with phones and tablets (Session 54): Remote devices list it under "Shared from Drashti". */
  shared?: true;
}

/** The order a playlist item plays its presentation in. */
export type ItemOrder =
  /** The presentation's own choice. */
  | { mode: 'presentation' }
  /** Every slide in order. */
  | { mode: 'all' }
  | { mode: 'arrangement'; arrangementId: string }
  /**
   * This playlist's own order of the presentation's slides (Session 55, Part 4b): a slide's row dragged within its
   * deck or presentation, or out of it into an item of its own. Its slides by id, so it lasts through the
   * presentation's edits (a slide deleted since drops out); the library's presentation never changes. `known`: every
   * slide the presentation had when the order was made, kept by the item that holds the deck's slides, so a slide
   * added to the presentation later plays at its end; an item made of a slide dragged out has none, and never takes
   * one added later.
   */
  | { mode: 'slides'; slideIds: string[]; known?: string[] };

/** The most slides an item's own order names (Session 55, Part 4b): far past any presentation's. */
export const OWN_ORDER_MAX = 10_000;

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
      /** How many slides it has (Session 26a: a playlist's cards say so). */
      slideCount?: number;
      /** It is a deck: a PDF, PowerPoint or Keynote file's pages as pictures (Session 15). */
      deck?: boolean;
      /** In a smart playlist: its file is gone from the folder (Session 26c). */
      gone?: boolean;
      /** Added from a phone (Session 54): the device's name. */
      fromDevice?: string;
    }
  | {
      id: string;
      kind: 'media';
      label: string;
      mediaId: string;
      /**
       * The library file's own name (C18, Session 58: FT-2), read with the row, never kept twice: what Rename… shows and
       * renames, where the row's label may be its own. Left out (an older Main's page): its label.
       */
      mediaName?: string;
      media: 'image' | 'video' | 'audio';
      /** The file was not found at import. */
      missing: boolean;
      /** What the file is, when Drashti cannot play it. */
      unplayable: string | null;
      timers: TimerCue[];
      /** A video's or sound's length, once Drashti has played it (Session 26a: on its card). */
      durationMs?: number | null;
      /** In a smart playlist: its file is gone from the folder (Session 26c). */
      gone?: boolean;
      /** Added from a phone (Session 54): the device's name. */
      fromDevice?: string;
      /** A video's When it ends (Session 55, Part 6): left out, the default (the chosen wallpaper). */
      whenEnds?: WhenEnds;
    }
  | { id: string; kind: 'header'; label: string; color: string | null }
  /**
   * A place for a presentation: a slot from a template (with the category
   * its search starts at, if any), or something the import could not find
   * (with a hint: the file it named). Fill it by choosing or dropping one.
   */
  | { id: string; kind: 'placeholder'; label: string; hint: string | null; category: string | null }
  /**
   * A passage from a book (Session 12; Shastra until alpha.15), named by keys so it lasts when its book is loaded
   * again: `missing` while no loaded book has it. Its label is the reference as it read when it was added.
   */
  | { id: string; kind: 'shastra'; label: string; passageId: string; missing: boolean; timers: TimerCue[] }
  /**
   * A video input (Session 51): one of a computer's cameras or capture inputs, named by its own name ("Input 1"),
   * which each computer finds in its own list (shared/video-inputs.ts inputNamed). It goes up as the background,
   * as a video does. `missing` while this computer has no input of that name: the item says so, playing it says
   * why, and Next goes on past it. Its label is the input's name as it was added.
   */
  | { id: string; kind: 'input'; label: string; name: string; missing: boolean; timers: TimerCue[] };

/** What can be added to a playlist. */
export type NewItem =
  | { kind: 'presentation'; presentationId: string }
  | { kind: 'media'; mediaId: string }
  | { kind: 'header'; label: string }
  | { kind: 'shastra'; passageId: string }
  /** One of this computer's video inputs, by its name (Session 51). */
  | { kind: 'input'; name: string };

/**
 * A slot that asks for a passage from a book (filling it opens the books' passage picker). Stored as libraries have
 * always stored it, "Shastra", Books' name until alpha.15, so an older library's slots ask for a passage still; it
 * is never shown as it is stored: slotCategoryName says Books.
 */
export const SHASTRA_SLOT = 'Shastra';

/** A slot's category as a person reads it: Books for a slot asking for a passage, a kirtan's category as it is. */
export function slotCategoryName(category: string): string {
  return category === SHASTRA_SLOT ? 'Books' : category;
}

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
  /** Taken from the drop folder (Session 28): Media's "From the drop folder" filter. */
  fromDrop?: true;
  /** Added from a phone (Session 54): the device's name, on its row. */
  fromDevice?: string;
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
export const PLAYLIST_IDS_MAX = 1000;
export const idListSchema = z.array(id).min(1).max(PLAYLIST_IDS_MAX);
/** A playlist's, a folder's or a header's name, cleaned as Rename… cleans a file's (Session 58, X3). */
export const playlistNameSchema = cleanNameSchema(200);
export const newItemsSchema: z.ZodType<NewItem[]> = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('presentation'), presentationId: id }).strict(),
      z.object({ kind: z.literal('media'), mediaId: id }).strict(),
      // A header's words as it is added, cleaned as when it is renamed (C15, FT-1).
      z.object({ kind: z.literal('header'), label: playlistNameSchema }).strict(),
      z.object({ kind: z.literal('shastra'), passageId: passageIdSchema }).strict(),
      z
        .object({ kind: z.literal('input'), name: z.string().trim().min(1).max(VIDEO_INPUT_NAME_MAX) })
        .strict(),
    ]),
  )
  .min(1)
  .max(500);
/** The furthest place a position can name: past the end, which is where it lands. */
export const POSITION_MAX = 100_000;
export const positionSchema = z.number().int().min(0).max(POSITION_MAX);
export const templateRequestSchema: z.ZodType<TemplateRequest> = z
  .object({ name: playlistNameSchema, slots: z.array(id).max(1000) })
  .strict();
export const timerCuesSchema: z.ZodType<TimerCue[]> = z
  .array(z.object({ timerId: id, action: z.enum(TIMER_CUE_ACTIONS) }).strict())
  .max(MAX_TIMER_CUES);

export const slotSchema = z
  .object({ label: cleanNameSchema(200), category: cleanNameSchema(60).nullable() })
  .strict();
export const itemOrderSchema: z.ZodType<ItemOrder> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('presentation') }).strict(),
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('arrangement'), arrangementId: id }).strict(),
  z
    .object({
      mode: z.literal('slides'),
      slideIds: z.array(id).min(1).max(OWN_ORDER_MAX),
      known: z.array(id).max(OWN_ORDER_MAX).optional(),
    })
    .strict(),
]);
