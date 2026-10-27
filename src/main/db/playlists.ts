import { randomUUID } from 'node:crypto';
import type { ImportSource } from '../../shared/library';
import type {
  ItemOrder,
  NewItem,
  PlaylistItemInfo,
  PlaylistKind,
  PlaylistNode,
} from '../../shared/playlists';
import { SHASTRA_SLOT, timerCuesSchema, type TimerCue } from '../../shared/playlists';
import type { RepeatSettings } from '../../shared/repeat';
import { DEFAULT_REPEAT, REPEAT_REFUSES, repeatSettingsOf } from '../../shared/repeat';
import type { PassageKey } from '../../shared/shastra';
import { parsePassageId, passageId, passageKeySchema } from '../../shared/shastra';
import type { VideoInput } from '../../shared/video-inputs';
import { ShastraRepo } from './shastra';
import type { PlayItem } from '../engine/playlist-source';
import { copyFinder } from '../convert/relink';
import type { Db } from './database';
import {
  filesFitFolders,
  FROM_FOLDER_SETTINGS,
  markedFromFolder,
  type PartFile,
} from '../playlists/folder-origin';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface ItemRow {
  id: string;
  kind: 'presentation' | 'media' | 'header' | 'placeholder' | 'shastra' | 'input';
  /** A passage's key, as JSON (shared/shastra.ts PassageKey). */
  passage: string | null;
  /** A video input's own name (Session 51, migration 47), for an input item. */
  input_name: string | null;
  /** Timer cues, as JSON (shared/playlists.ts TimerCue). */
  timers: string | null;
  label: string;
  color: string | null;
  hint: string | null;
  category: string | null;
  presentation_id: string | null;
  media_id: string | null;
  order_mode: 'presentation' | 'arrangement' | 'all';
  arrangement_id: string | null;
  presentation_name: string | null;
  presentation_deleted: string | null;
  arrangement_name: string | null;
  media_kind: 'image' | 'video' | 'audio' | null;
  media_missing: number | null;
  media_playable: number | null;
  media_format: string | null;
  presentation_slides: number | null;
  presentation_source: string | null;
  media_duration: number | null;
  /** In a smart playlist, 1 when its file is gone from the folder (Session 26c). */
  smart_gone: number;
  /** Added from a phone (Session 54, migration 52): the device's name. */
  media_device: string | null;
  presentation_device: string | null;
}

/** Stored timer cues; none when they do not read. */
function cuesOf(json: string | null): TimerCue[] {
  if (json === null) return [];
  try {
    const parsed = timerCuesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A stored passage key; null when it does not read. */
function keyOf(json: string | null): PassageKey | null {
  if (json === null) return null;
  try {
    const parsed = passageKeySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function itemInfo(
  r: ItemRow,
  passageThere: (key: PassageKey) => boolean,
  input: (name: string) => VideoInput | null,
): PlaylistItemInfo {
  switch (r.kind) {
    case 'input': {
      const name = r.input_name ?? r.label;
      return {
        id: r.id,
        kind: 'input',
        label: r.label,
        name,
        missing: input(name) === null,
        timers: cuesOf(r.timers),
      };
    }
    case 'shastra': {
      const key = keyOf(r.passage);
      return {
        id: r.id,
        kind: 'shastra',
        label: r.label,
        passageId: key ? passageId(key) : '',
        missing: !key || !passageThere(key),
        timers: cuesOf(r.timers),
      };
    }
    case 'presentation': {
      const order: ItemOrder =
        r.order_mode === 'all'
          ? { mode: 'all' }
          : r.order_mode === 'arrangement' && r.arrangement_id
            ? { mode: 'arrangement', arrangementId: r.arrangement_id }
            : { mode: 'presentation' };
      return {
        id: r.id,
        kind: 'presentation',
        label: r.label,
        presentationId: r.presentation_id ?? '',
        presentationName: r.presentation_deleted === null ? r.presentation_name : null,
        order,
        arrangementName: order.mode === 'arrangement' ? r.arrangement_name : null,
        timers: cuesOf(r.timers),
        slideCount: r.presentation_slides ?? 0,
        deck: r.presentation_source === 'pictures',
        ...(r.smart_gone === 1 ? { gone: true } : {}),
        ...(r.presentation_device === null ? {} : { fromDevice: r.presentation_device }),
      };
    }
    case 'media':
      return {
        id: r.id,
        kind: 'media',
        label: r.label,
        mediaId: r.media_id ?? '',
        media: r.media_kind ?? 'video',
        missing: r.media_missing === 1,
        unplayable: r.media_playable === 0 ? (r.media_format ?? 'a kind of file Drashti cannot play') : null,
        timers: cuesOf(r.timers),
        durationMs: r.media_duration !== null && r.media_duration > 0 ? r.media_duration : null,
        ...(r.smart_gone === 1 ? { gone: true } : {}),
        ...(r.media_device === null ? {} : { fromDevice: r.media_device }),
      };
    case 'header':
      return { id: r.id, kind: 'header', label: r.label, color: r.color };
    case 'placeholder':
      return { id: r.id, kind: 'placeholder', label: r.label, hint: r.hint, category: r.category };
  }
}

/** An item copied into a template, or from one into a new playlist. */
type CopyItem = (
  | { kind: 'header'; label: string; color: string | null }
  | {
      kind: 'presentation';
      presentationId: string;
      label: string;
      orderMode: string;
      arrangementId: string | null;
    }
  | { kind: 'media'; mediaId: string; label: string }
  | { kind: 'placeholder'; label: string; hint: string | null; category: string | null }
  | { kind: 'shastra'; passage: string; label: string }
  | { kind: 'input'; name: string; label: string }
) & {
  /** Its timer cues, as stored (a template keeps them; a playlist from it gets them). */
  timers?: string | null;
};

/*
 * Playlists and folders of playlists: imported ones (replaced as a whole
 * when their file is imported again) and the operator's own. Removing keeps
 * the rows with deleted_at set, so Undo brings them back exactly.
 */

export type NewPlaylistItem =
  /** arrangementRef: the source file's id of the arrangement the item plays its presentation in. */
  | { kind: 'presentation'; presentationId: string; label: string; arrangementRef?: string | null }
  | { kind: 'media'; mediaId: string; label: string }
  | { kind: 'header'; label: string; color: string | null }
  | { kind: 'placeholder'; label: string; hint: string | null };

export interface NewPlaylist {
  name: string;
  isFolder: boolean;
  /** The playlist's own id in the source file. */
  ref: string | null;
  items: NewPlaylistItem[];
  children: NewPlaylist[];
}

export interface PlaylistCounts {
  playlists: number;
  items: number;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  itemCount: number;
}

/** This computer's video input of a name (shared/video-inputs.ts inputNamed), or null. */
export type InputLookup = (name: string) => VideoInput | null;

export class PlaylistRepo {
  private readonly shastra: ShastraRepo;

  /**
   * `input`: this computer's video input of a name (Session 51), for the items naming one; none when left out
   * (an import's own repo), so every such item reads as not on this computer.
   */
  constructor(
    private readonly db: Db,
    private readonly input: InputLookup = () => null,
  ) {
    this.shastra = new ShastraRepo(db);
  }

  /** Top-level playlists imported from this file, with the hash they were imported with. */
  findImported(
    kind: ImportSource['kind'],
    path: string,
  ): { id: string; name: string; hash: string | null }[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, source_hash FROM playlists WHERE source_kind = ? AND source_path = ? AND parent_id IS NULL ORDER BY position',
        )
        .all(kind, path) as { id: string; name: string; source_hash: string | null }[]
    ).map((r) => ({ id: r.id, name: r.name, hash: r.source_hash }));
  }

  /** Remove the playlists imported from this file (their items and sub-playlists go with them). */
  removeImported(kind: ImportSource['kind'], path: string): number {
    return this.db
      .prepare('DELETE FROM playlists WHERE source_kind = ? AND source_path = ? AND parent_id IS NULL')
      .run(kind, path).changes;
  }

  /** Insert a tree of playlists at the top level, after the ones already there. */
  insertTree(
    playlists: readonly NewPlaylist[],
    source: ImportSource,
    hash: string | null,
  ): PlaylistCounts & { ids: string[] } {
    const counts = { playlists: 0, items: 0, ids: [] as string[] };
    const insertPlaylist = this.db.prepare(
      `INSERT INTO playlists (id, parent_id, name, is_folder, position, source_kind, source_path, source_ref, source_imported_at, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label, color, hint, arrangement_id, order_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // The arrangement a playlist item names, found by its id in the source file.
    const arrangementByRef = this.db.prepare(
      'SELECT id FROM arrangements WHERE presentation_id = ? AND source_ref = ? ORDER BY position LIMIT 1',
    );
    const top = (
      this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlists WHERE parent_id IS NULL')
        .get() as {
        next: number;
      }
    ).next;
    const write = (list: NewPlaylist, parentId: string | null, position: number) => {
      const id = randomUUID();
      insertPlaylist.run(
        id,
        parentId,
        list.name,
        list.isFolder ? 1 : 0,
        position,
        source.kind,
        source.path,
        list.ref,
        source.importedAt,
        parentId === null ? hash : null,
      );
      counts.playlists++;
      if (parentId === null) counts.ids.push(id);
      list.items.forEach((item, i) => {
        const arrangement =
          item.kind === 'presentation' && item.arrangementRef
            ? (arrangementByRef.get(item.presentationId, item.arrangementRef) as { id: string } | undefined)
            : undefined;
        insertItem.run(
          randomUUID(),
          id,
          i,
          item.kind,
          item.kind === 'presentation' ? item.presentationId : null,
          item.kind === 'media' ? item.mediaId : null,
          item.label,
          item.kind === 'header' ? item.color : null,
          item.kind === 'placeholder' ? item.hint : null,
          arrangement?.id ?? null,
          arrangement ? 'arrangement' : 'presentation',
        );
        counts.items++;
      });
      list.children.forEach((child, i) => {
        write(child, id, i);
      });
    };
    playlists.forEach((list, i) => {
      write(list, null, top + i);
    });
    return counts;
  }

  /** Every playlist and folder, parents before children. */
  list(): PlaylistSummary[] {
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.is_folder, p.parent_id,
                  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.deleted_at IS NULL) AS item_count
             FROM playlists p WHERE p.deleted_at IS NULL ORDER BY p.parent_id IS NOT NULL, p.position, p.rowid`,
        )
        .all() as {
        id: string;
        name: string;
        is_folder: number;
        parent_id: string | null;
        item_count: number;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      isFolder: r.is_folder === 1,
      parentId: r.parent_id,
      itemCount: r.item_count,
    }));
  }

  /** The items of a playlist, in order. */
  items(
    playlistId: string,
  ): { kind: string; label: string; presentationId: string | null; mediaId: string | null }[] {
    return (
      this.db
        .prepare(
          'SELECT kind, label, presentation_id, media_id FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL ORDER BY position, rowid',
        )
        .all(playlistId) as {
        kind: string;
        label: string;
        presentation_id: string | null;
        media_id: string | null;
      }[]
    ).map((r) => ({ kind: r.kind, label: r.label, presentationId: r.presentation_id, mediaId: r.media_id }));
  }

  // ---- the operator's editing -----------------------------------------------------

  /**
   * Every playlist and folder not removed, each parent before its children,
   * in order; or (templates) the sabha templates, kept apart from them.
   */
  tree(templates = false): PlaylistNode[] {
    // Made from a folder (Session 44): shown a folder at a time. Templates never are.
    const fromFolder = templates ? new Set<string>() : this.fromFolderIds();
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.is_folder, p.parent_id, p.source_kind, p.kind, p.settings, p.shared_at,
                (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.deleted_at IS NULL) AS item_count,
                (SELECT COUNT(*) FROM playlist_items i
                  WHERE i.playlist_id = p.id AND i.deleted_at IS NULL AND i.kind = 'placeholder') AS placeholders
           FROM playlists p WHERE p.deleted_at IS NULL AND p.is_template = ? ORDER BY p.position, p.rowid`,
      )
      .all(templates ? 1 : 0) as {
      id: string;
      name: string;
      is_folder: number;
      parent_id: string | null;
      source_kind: string | null;
      kind: PlaylistKind;
      settings: string | null;
      shared_at: string | null;
      item_count: number;
      placeholders: number;
    }[];
    const children = new Map<string | null, typeof rows>();
    for (const r of rows) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
    const out: PlaylistNode[] = [];
    const walk = (parentId: string | null) => {
      for (const r of children.get(parentId) ?? []) {
        out.push({
          id: r.id,
          name: r.name,
          isFolder: r.is_folder === 1,
          kind: r.kind,
          ...(r.kind === 'repeat' ? { repeat: repeatSettingsOf(r.settings) } : {}),
          parentId: r.parent_id,
          itemCount: r.item_count,
          placeholders: r.placeholders,
          imported: r.source_kind !== null,
          template: templates,
          ...(fromFolder.has(r.id) ? { fromFolder: true as const } : {}),
          ...(r.shared_at === null ? {} : { shared: true as const }),
        });
        if (r.is_folder === 1) walk(r.id);
      }
    };
    walk(null);
    return out;
  }

  /** A playlist's items that are not removed, in order, with what they point at. */
  itemsOf(playlistId: string): PlaylistItemInfo[] {
    return (
      this.db
        .prepare(
          `SELECT i.id, i.kind, i.label, i.color, i.hint, i.category, i.presentation_id, i.media_id, i.order_mode, i.arrangement_id,
                  i.passage, i.timers, i.input_name,
                  p.name AS presentation_name, p.deleted_at AS presentation_deleted, a.name AS arrangement_name,
                  m.kind AS media_kind, m.missing AS media_missing, m.playable AS media_playable, m.format AS media_format,
                  p.slide_count AS presentation_slides, p.source_kind AS presentation_source, m.duration_ms AS media_duration,
                  m.from_device AS media_device, p.from_device AS presentation_device,
                  EXISTS (SELECT 1 FROM smart_files sf WHERE sf.item_id = i.id AND sf.state = 'missing') AS smart_gone
             FROM playlist_items i
             LEFT JOIN presentations p ON p.id = i.presentation_id
             LEFT JOIN arrangements a ON a.id = i.arrangement_id
             LEFT JOIN media m ON m.id = i.media_id
            WHERE i.playlist_id = ? AND i.deleted_at IS NULL
            ORDER BY i.position, i.rowid`,
        )
        .all(playlistId) as ItemRow[]
    ).map((r) =>
      itemInfo(
        r,
        (key) => this.shastra.passage(key) !== null,
        (name) => this.input(name),
      ),
    );
  }

  /** A playlist's items as the show engine plays them, or null if the playlist does not exist (or was removed). */
  playItems(playlistId: string): PlayItem[] | null {
    // A template is never run: only playlists made from it are.
    if (!this.isOpenPlaylist(playlistId, false) || this.isTemplate(playlistId)) return null;
    return this.itemsOf(playlistId).map((item): PlayItem => {
      switch (item.kind) {
        case 'presentation':
          if (item.presentationName === null)
            return { id: item.id, kind: 'skip', why: `“${item.label}” is no longer in the library` };
          return {
            id: item.id,
            kind: 'presentation',
            presentationId: item.presentationId,
            label: item.label,
            timers: item.timers,
            arrangementId:
              item.order.mode === 'presentation'
                ? undefined
                : item.order.mode === 'all'
                  ? null
                  : item.order.arrangementId,
          };
        case 'media':
          if (item.missing)
            return { id: item.id, kind: 'skip', why: `The file for “${item.label}” is missing` };
          if (item.unplayable !== null)
            return {
              id: item.id,
              kind: 'skip',
              why: `Drashti cannot play “${item.label}” (${item.unplayable})`,
            };
          return {
            id: item.id,
            kind: 'media',
            mediaId: item.mediaId,
            media: item.media,
            label: item.label,
            timers: item.timers,
          };
        case 'header':
          return {
            id: item.id,
            kind: 'skip',
            why: 'A header has nothing to show',
            label: item.label,
            header: true,
          };
        case 'placeholder':
          return {
            id: item.id,
            kind: 'skip',
            why:
              item.hint === null
                ? `“${item.label}” is not filled in yet`
                : `“${item.label}” was not found at import`,
          };
        case 'input': {
          // This computer's input of its name (Session 51), found again as the show reads the playlist.
          const found = this.input(item.name);
          if (!found)
            return {
              id: item.id,
              kind: 'skip',
              why: `The video input “${item.name}” is not on this computer`,
            };
          return { id: item.id, kind: 'input', inputId: found.id, label: item.label, timers: item.timers };
        }
        case 'shastra':
          // A passage plays like a presentation (shared/shastra.ts), while its text is loaded.
          return item.missing
            ? { id: item.id, kind: 'skip', why: `“${item.label}”: its Shastra text is not loaded` }
            : {
                id: item.id,
                kind: 'presentation',
                presentationId: item.passageId,
                label: item.label,
                arrangementId: null,
                timers: item.timers,
              };
      }
    });
  }

  /**
   * Share a playlist with phones and tablets, or stop (Session 54): a playlist (a folder playlist too), never a
   * folder of playlists or a template. Shared again, it keeps its first time. False when there is no such one.
   */
  setShared(id: string, on: boolean): boolean {
    return (
      this.db
        .prepare(
          `UPDATE playlists SET shared_at = CASE WHEN ? = 1 THEN COALESCE(shared_at, ${NOW}) ELSE NULL END
            WHERE id = ? AND deleted_at IS NULL AND is_folder = 0 AND is_template = 0`,
        )
        .run(on ? 1 : 0, id).changes > 0
    );
  }

  /** The playlists shared with phones (Session 54), in the order they were shared, with their items' count. */
  sharedPlaylists(): { id: string; name: string; itemCount: number; fromFolder: boolean }[] {
    const fromFolder = this.fromFolderIds();
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name,
                  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.deleted_at IS NULL) AS item_count
             FROM playlists p
            WHERE p.shared_at IS NOT NULL AND p.deleted_at IS NULL AND p.is_folder = 0 AND p.is_template = 0
            ORDER BY p.shared_at, p.rowid`,
        )
        .all() as { id: string; name: string; item_count: number }[]
    ).map((r) => ({ id: r.id, name: r.name, itemCount: r.item_count, fromFolder: fromFolder.has(r.id) }));
  }

  /** Whether a playlist is shared with phones now (Session 54). */
  isShared(id: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM playlists WHERE id = ? AND shared_at IS NOT NULL AND deleted_at IS NULL AND is_template = 0',
        )
        .get(id) !== undefined
    );
  }

  /** Whether a playlist is a sabha template. */
  isTemplate(id: string): boolean {
    const row = this.db.prepare('SELECT is_template FROM playlists WHERE id = ?').get(id) as
      { is_template: number } | undefined;
    return row?.is_template === 1;
  }

  private isOpenPlaylist(id: string, folder: boolean): boolean {
    const row = this.db
      .prepare('SELECT is_folder FROM playlists WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { is_folder: number } | undefined;
    return row?.is_folder === (folder ? 1 : 0);
  }

  /**
   * A new playlist or folder, last in its folder (or at the top level); or
   * a template (always at the top level, apart from the playlists). Null if
   * that folder is gone.
   */
  create(name: string, parentId: string | null, isFolder: boolean, template = false): string | null {
    if (parentId !== null && (template || !this.isOpenPlaylist(parentId, true))) return null;
    const id = randomUUID();
    this.db.transaction(() => {
      const next = (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlists WHERE parent_id IS ? AND deleted_at IS NULL',
          )
          .get(parentId) as { next: number }
      ).next;
      this.db
        .prepare(
          'INSERT INTO playlists (id, parent_id, name, is_folder, position, is_template) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, parentId, name, isFolder && !template ? 1 : 0, next, template ? 1 : 0);
    })();
    return id;
  }

  /**
   * A new playlist at the top of the list, not in a folder (Session 26c: a Dropbox folder's playlist, opened
   * as it is made). Its id.
   */
  createAtTop(name: string): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO playlists (id, parent_id, name, is_folder, position, is_template)
         VALUES (?, NULL, ?, 0, (SELECT COALESCE(MIN(position), 0) - 1 FROM playlists WHERE parent_id IS NULL), 0)`,
      )
      .run(id, name);
    return id;
  }

  /** Mark a plain playlist as made from a folder (Session 44: a Dropbox folder link's), so it is shown a folder at a time. */
  markFromFolder(id: string): void {
    this.db
      .prepare("UPDATE playlists SET settings = ? WHERE id = ? AND kind = 'normal'")
      .run(FROM_FOLDER_SETTINGS, id);
  }

  /**
   * The playlists made from a folder (Session 44, playlists/folder-origin.ts): smart ones, plain ones marked so,
   * and plain ones an earlier version made from a folder link, whose files lie in the folders their headers name
   * (marked as they are found).
   */
  fromFolderIds(): Set<string> {
    const out = new Set<string>();
    const playlists = this.db
      .prepare(
        "SELECT id, kind, settings FROM playlists WHERE deleted_at IS NULL AND is_folder = 0 AND is_template = 0 AND kind IN ('smart', 'normal')",
      )
      .all() as { id: string; kind: PlaylistKind; settings: string | null }[];
    for (const p of playlists) if (p.kind === 'smart' || markedFromFolder(p.settings)) out.add(p.id);
    // The rest that have headers: does each part's file lie where its header says?
    const rows = this.db
      .prepare(
        `SELECT i.playlist_id, i.kind, i.label, COALESCE(m.source_path, pr.source_path) AS file
           FROM playlist_items i
           LEFT JOIN media m ON m.id = i.media_id
           LEFT JOIN presentations pr ON pr.id = i.presentation_id
          WHERE i.deleted_at IS NULL AND i.playlist_id IN (
            SELECT h.playlist_id FROM playlist_items h
             WHERE h.kind = 'header' AND h.deleted_at IS NULL)
          ORDER BY i.playlist_id, i.position`,
      )
      .all() as { playlist_id: string; kind: string; label: string; file: string | null }[];
    const plain = new Set(playlists.filter((p) => p.kind === 'normal' && !out.has(p.id)).map((p) => p.id));
    const files = new Map<string, PartFile[]>();
    let part = '';
    let current = '';
    for (const r of rows) {
      if (r.playlist_id !== current) {
        current = r.playlist_id;
        part = '';
      }
      if (!plain.has(r.playlist_id)) continue;
      if (r.kind === 'header') part = r.label;
      else if (r.file !== null)
        files.set(r.playlist_id, [...(files.get(r.playlist_id) ?? []), { part, file: r.file }]);
    }
    // Seen once as made from a folder, it is marked so: something added later from elsewhere (a kirtan, a
    // file from the desktop) never undoes it.
    for (const [id, found] of files)
      if (filesFitFolders(found)) {
        this.markFromFolder(id);
        out.add(id);
      }
    return out;
  }

  /**
   * A smart playlist following `folder` (Session 26c), at the top of the list, not in a folder. Its id.
   */
  createSmart(name: string, folder: string): string {
    const id = this.createAtTop(name);
    this.db
      .prepare("UPDATE playlists SET kind = 'smart', settings = ? WHERE id = ?")
      .run(JSON.stringify({ folder }), id);
    return id;
  }

  /**
   * A new Repeat Slides playlist (Session 26d), last in its folder (or at the top level), going round with
   * the settings to begin with. Null if that folder is gone.
   */
  createRepeat(name: string, parentId: string | null): string | null {
    const id = this.create(name, parentId, false);
    if (id)
      this.db
        .prepare("UPDATE playlists SET kind = 'repeat', settings = ? WHERE id = ?")
        .run(JSON.stringify(DEFAULT_REPEAT), id);
    return id;
  }

  /** A Repeat Slides playlist's name and settings, or null when it is not one (or is deleted). */
  repeatPlaylist(id: string): { name: string; settings: RepeatSettings } | null {
    const row = this.db
      .prepare("SELECT name, settings FROM playlists WHERE id = ? AND kind = 'repeat' AND deleted_at IS NULL")
      .get(id) as { name: string; settings: string | null } | undefined;
    return row ? { name: row.name, settings: repeatSettingsOf(row.settings) } : null;
  }

  /** Change a Repeat Slides playlist's settings (checked by the caller). */
  setRepeatSettings(id: string, settings: RepeatSettings): boolean {
    return (
      this.db
        .prepare("UPDATE playlists SET settings = ? WHERE id = ? AND kind = 'repeat' AND deleted_at IS NULL")
        .run(JSON.stringify(settings), id).changes === 1
    );
  }

  /**
   * Why these items cannot be added to the playlist, or null: a Repeat Slides playlist takes no videos or
   * sounds (Session 26d).
   */
  refusal(playlistId: string, items: readonly NewItem[]): string | null {
    const media = items.flatMap((i) => (i.kind === 'media' ? [i.mediaId] : []));
    const inputs = items.some((i) => i.kind === 'input');
    if ((media.length === 0 && !inputs) || this.repeatPlaylist(playlistId) === null) return null;
    // A video input (Session 51) is live video: it cannot go round either.
    if (inputs) return REPEAT_REFUSES;
    const kind = this.db.prepare('SELECT kind FROM media WHERE id = ?');
    const moving = media.some((id) => (kind.get(id) as { kind: string } | undefined)?.kind !== 'image');
    return moving ? REPEAT_REFUSES : null;
  }

  /**
   * Point an item at what its file became, in place (Session 26c: a smart playlist's changed file). A media
   * item takes the new media's name; nothing changes for a different kind of item.
   */
  retarget(itemId: string, to: NewItem): boolean {
    if (to.kind === 'media')
      return (
        this.db
          .prepare(
            `UPDATE playlist_items SET media_id = @to, label = (SELECT name FROM media WHERE id = @to)
              WHERE id = @item AND kind = 'media' AND EXISTS (SELECT 1 FROM media WHERE id = @to)`,
          )
          .run({ to: to.mediaId, item: itemId }).changes === 1
      );
    if (to.kind === 'presentation')
      return (
        this.db
          .prepare(
            `UPDATE playlist_items SET presentation_id = @to
              WHERE id = @item AND kind = 'presentation' AND EXISTS (SELECT 1 FROM presentations WHERE id = @to)`,
          )
          .run({ to: to.presentationId, item: itemId }).changes === 1
      );
    return false;
  }

  /** Copy items into a playlist at its end (headers, presentations, media and slots), in one go. */
  private copyItems(to: string, items: readonly CopyItem[]): void {
    const insert = this.db.prepare(
      `INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label, color, hint, category, order_mode, arrangement_id, passage, timers, input_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // An item on a converted original (added before Session 51) is copied onto its copy.
    const copy = copyFinder(this.db);
    const start = this.order(to).length;
    items.forEach((item, i) => {
      insert.run(
        randomUUID(),
        to,
        start + i,
        item.kind,
        item.kind === 'presentation' ? item.presentationId : null,
        item.kind === 'media' ? copy(item.mediaId) : null,
        item.label,
        item.kind === 'header' ? item.color : null,
        item.kind === 'placeholder' ? item.hint : null,
        item.kind === 'placeholder' ? item.category : null,
        item.kind === 'presentation' ? item.orderMode : 'presentation',
        item.kind === 'presentation' ? item.arrangementId : null,
        item.kind === 'shastra' ? item.passage : null,
        item.kind === 'header' || item.kind === 'placeholder' ? null : (item.timers ?? null),
        item.kind === 'input' ? item.name : null,
      );
    });
  }

  /** A playlist's items as stored, for copying. */
  private storedItems(playlistId: string) {
    return this.db
      .prepare(
        `SELECT i.id, i.kind, i.label, i.color, i.hint, i.category, i.presentation_id, i.media_id, i.order_mode, i.arrangement_id,
                i.passage, i.timers, i.input_name, k.category AS kirtan_category, p.deleted_at AS presentation_deleted
           FROM playlist_items i
           LEFT JOIN presentations p ON p.id = i.presentation_id
           LEFT JOIN kirtans k ON k.presentation_id = i.presentation_id
          WHERE i.playlist_id = ? AND i.deleted_at IS NULL ORDER BY i.position, i.rowid`,
      )
      .all(playlistId) as {
      id: string;
      kind: 'presentation' | 'media' | 'header' | 'placeholder' | 'shastra' | 'input';
      label: string;
      color: string | null;
      hint: string | null;
      category: string | null;
      presentation_id: string | null;
      media_id: string | null;
      order_mode: string;
      arrangement_id: string | null;
      passage: string | null;
      timers: string | null;
      input_name: string | null;
      kirtan_category: string | null;
      presentation_deleted: string | null;
    }[];
  }

  /**
   * A new template from a playlist: its headers, media and presentations as
   * they are, except the items named as slots, which become slots named
   * after the kirtan's category (else the item), with that category for the
   * search. Placeholders stay slots. Null if the playlist is gone.
   */
  saveAsTemplate(playlistId: string, name: string, slots: readonly string[]): string | null {
    if (!this.isOpenPlaylist(playlistId, false)) return null;
    return this.db.transaction(() => {
      const id = this.create(name, null, false, true);
      if (!id) return null;
      const slot = new Set(slots);
      this.copyItems(
        id,
        this.storedItems(playlistId).flatMap((r): CopyItem[] => {
          if (r.kind === 'header') return [{ kind: 'header', label: r.label, color: r.color }];
          if (r.kind === 'media' && r.media_id)
            return [{ kind: 'media', mediaId: r.media_id, label: r.label, timers: r.timers }];
          // A video input (Session 51) stays as it is, named as it was.
          if (r.kind === 'input' && r.input_name !== null)
            return [{ kind: 'input', name: r.input_name, label: r.label, timers: r.timers }];
          // A passage stays as it is, or becomes a slot that asks for one.
          if (r.kind === 'shastra' && r.passage !== null)
            return slot.has(r.id)
              ? [{ kind: 'placeholder', label: r.label, hint: null, category: SHASTRA_SLOT }]
              : [{ kind: 'shastra', passage: r.passage, label: r.label, timers: r.timers }];
          if (r.kind === 'placeholder' || (r.kind === 'presentation' && slot.has(r.id)))
            return [
              {
                kind: 'placeholder',
                label: r.kind === 'placeholder' ? r.label : (r.kirtan_category ?? r.label),
                hint: null,
                category: r.kind === 'placeholder' ? r.category : r.kirtan_category,
              },
            ];
          if (r.kind === 'presentation' && r.presentation_id && r.presentation_deleted === null)
            return [
              {
                kind: 'presentation',
                presentationId: r.presentation_id,
                label: r.label,
                orderMode: r.order_mode,
                arrangementId: r.arrangement_id,
                timers: r.timers,
              },
            ];
          return [];
        }),
      );
      return id;
    })();
  }

  /**
   * A new playlist from a template, in this folder (or at the top level):
   * every item of the template, with its slots ready to fill. Null if the
   * template or the folder is gone.
   */
  newFromTemplate(templateId: string, name: string, parentId: string | null): string | null {
    if (!this.isTemplate(templateId) || !this.isOpenPlaylist(templateId, false)) return null;
    return this.db.transaction(() => {
      const id = this.create(name, parentId, false);
      if (!id) return null;
      this.copyItems(
        id,
        this.storedItems(templateId).flatMap((r): CopyItem[] => {
          if (r.kind === 'header') return [{ kind: 'header', label: r.label, color: r.color }];
          if (r.kind === 'media' && r.media_id)
            return [{ kind: 'media', mediaId: r.media_id, label: r.label, timers: r.timers }];
          if (r.kind === 'placeholder')
            return [{ kind: 'placeholder', label: r.label, hint: null, category: r.category }];
          if (r.kind === 'shastra' && r.passage !== null)
            return [{ kind: 'shastra', passage: r.passage, label: r.label, timers: r.timers }];
          if (r.kind === 'input' && r.input_name !== null)
            return [{ kind: 'input', name: r.input_name, label: r.label, timers: r.timers }];
          if (r.presentation_id && r.presentation_deleted === null)
            return [
              {
                kind: 'presentation',
                presentationId: r.presentation_id,
                label: r.label,
                orderMode: r.order_mode,
                arrangementId: r.arrangement_id,
                timers: r.timers,
              },
            ];
          return [];
        }),
      );
      return id;
    })();
  }

  /** A slot (a place to fill each time) in a playlist or template, at a position or the end. */
  addSlot(playlistId: string, at: number | null, label: string, category: string | null): string | null {
    if (!this.isOpenPlaylist(playlistId, false)) return null;
    return this.db.transaction(() => {
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO playlist_items (id, playlist_id, position, kind, label, category) VALUES (?, ?, 0, 'placeholder', ?, ?)",
        )
        .run(id, playlistId, label, category);
      const current = this.order(playlistId).filter((x) => x !== id);
      const where = at === null ? current.length : Math.max(0, Math.min(at, current.length));
      this.renumber([...current.slice(0, where), id, ...current.slice(where)]);
      return id;
    })();
  }

  /**
   * The operator opened a playlist on Main (Session 14): it counts as this
   * week's for nodes from now. Returns true when it did not count before
   * (nothing about it was newer than `recentSince`), so what nodes copy changes.
   */
  markOpened(id: string, recentSince: string): boolean {
    const row = this.db
      .prepare(
        `SELECT max(created_at, coalesce(updated_at, ''), coalesce(opened_at, '')) AS latest
           FROM playlists WHERE id = ? AND is_folder = 0 AND deleted_at IS NULL`,
      )
      .get(id) as { latest: string | null } | undefined;
    if (!row) return false;
    this.db.prepare(`UPDATE playlists SET opened_at = ${NOW} WHERE id = ?`).run(id);
    return (row.latest ?? '') < recentSince;
  }

  rename(id: string, name: string): boolean {
    return (
      this.db
        .prepare(`UPDATE playlists SET name = ?, updated_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`)
        .run(name, id).changes === 1
    );
  }

  /** Remove playlists or folders (a folder with everything in it). Returns every id removed, for Undo. */
  remove(ids: readonly string[]): string[] {
    const removed: string[] = [];
    this.db.transaction(() => {
      const subtree = this.db.prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM playlists WHERE id = ? AND deleted_at IS NULL
           UNION ALL SELECT p.id FROM playlists p JOIN sub ON p.parent_id = sub.id WHERE p.deleted_at IS NULL
         ) SELECT id FROM sub`,
      );
      const mark = this.db.prepare(
        `UPDATE playlists SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`,
      );
      for (const id of ids) {
        for (const row of subtree.all(id) as { id: string }[])
          if (mark.run(row.id).changes === 1) removed.push(row.id);
      }
    })();
    return removed;
  }

  /** Bring back removed playlists and folders (Undo). */
  restore(ids: readonly string[]): string[] {
    const stmt = this.db.prepare(
      'UPDATE playlists SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
    );
    return this.db.transaction(() => ids.filter((id) => stmt.run(id).changes === 1))();
  }

  /** The ids of a playlist's items that are not removed, in order. */
  private order(playlistId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT id FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL ORDER BY position, rowid',
        )
        .all(playlistId) as { id: string }[]
    ).map((r) => r.id);
  }

  private renumber(ids: readonly string[]): void {
    const stmt = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?');
    ids.forEach((id, i) => stmt.run(i, id));
  }

  /**
   * Add presentations, media or headers to a playlist at a position (the end
   * when it is null). Returns the new items' ids; none if the playlist is
   * gone or something added does not exist.
   */
  addItems(playlistId: string, at: number | null, given: readonly NewItem[]): string[] {
    // A converted original lands on its copy (Session 51), as every item that had it was moved there.
    const copy = copyFinder(this.db);
    const items = given.map((item): NewItem =>
      item.kind === 'media' ? { ...item, mediaId: copy(item.mediaId) } : item,
    );
    if (!this.isOpenPlaylist(playlistId, false) || this.refusal(playlistId, items) !== null) return [];
    const presentationName = this.db.prepare(
      'SELECT name FROM presentations WHERE id = ? AND deleted_at IS NULL',
    );
    // Never media deleted from the library (Session 26a).
    const mediaName = this.db.prepare('SELECT name FROM media WHERE id = ? AND deleted_at IS NULL');
    const insert = this.db.prepare(
      'INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label, passage, input_name) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)',
    );
    // Every item must exist before anything is written: a video input on this computer (Session 51), named as
    // Media names it.
    const labels: string[] = [];
    const passages: (string | null)[] = [];
    for (const item of items) {
      const key = item.kind === 'shastra' ? parsePassageId(item.passageId) : null;
      const display = key ? this.shastra.display(key) : null;
      const row =
        item.kind === 'presentation'
          ? (presentationName.get(item.presentationId) as { name: string } | undefined)
          : item.kind === 'media'
            ? (mediaName.get(item.mediaId) as { name: string } | undefined)
            : item.kind === 'shastra'
              ? display === null
                ? undefined
                : { name: display }
              : item.kind === 'input'
                ? (this.input(item.name) ?? undefined)
                : { name: item.label };
      if (!row) return [];
      labels.push(row.name);
      passages.push(key ? JSON.stringify(key) : null);
    }
    return this.db.transaction(() => {
      const ids: string[] = items.map((item, i) => {
        const id = randomUUID();
        insert.run(
          id,
          playlistId,
          item.kind,
          item.kind === 'presentation' ? item.presentationId : null,
          item.kind === 'media' ? item.mediaId : null,
          labels[i] ?? '',
          passages[i] ?? null,
          item.kind === 'input' ? (labels[i] ?? item.name) : null,
        );
        return id;
      });
      const current = this.order(playlistId).filter((id) => !ids.includes(id));
      const where = at === null ? current.length : Math.max(0, Math.min(at, current.length));
      this.renumber([...current.slice(0, where), ...ids, ...current.slice(where)]);
      return ids;
    })();
  }

  /** Move items within their playlist, so the first lands at `to` among the others. */
  moveItems(playlistId: string, ids: readonly string[], to: number): boolean {
    return this.db.transaction(() => {
      const current = this.order(playlistId);
      const moving = current.filter((id) => ids.includes(id));
      if (moving.length !== ids.length) return false;
      const rest = current.filter((id) => !ids.includes(id));
      const where = Math.max(0, Math.min(to, rest.length));
      this.renumber([...rest.slice(0, where), ...moving, ...rest.slice(where)]);
      return true;
    })();
  }

  /** Remove items (Undo brings them back where they were). Returns the ids removed. */
  removeItems(ids: readonly string[]): string[] {
    const stmt = this.db.prepare(
      `UPDATE playlist_items SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`,
    );
    return this.db.transaction(() => ids.filter((id) => stmt.run(id).changes === 1))();
  }

  restoreItems(ids: readonly string[]): string[] {
    const stmt = this.db.prepare(
      'UPDATE playlist_items SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
    );
    return this.db.transaction(() => ids.filter((id) => stmt.run(id).changes === 1))();
  }

  /** The playlist an item is in (removed items too), or null. */
  playlistOf(itemId: string): string | null {
    const row = this.db.prepare('SELECT playlist_id FROM playlist_items WHERE id = ?').get(itemId) as
      { playlist_id: string } | undefined;
    return row?.playlist_id ?? null;
  }

  /** Put a presentation (or a Shastra passage) where the import left a placeholder, or in a slot. */
  fillPlaceholder(itemId: string, presentationId: string): boolean {
    const key = parsePassageId(presentationId);
    if (key) {
      const display = this.shastra.display(key);
      if (display === null) return false;
      return (
        this.db
          .prepare(
            `UPDATE playlist_items SET kind = 'shastra', passage = ?, label = ?, hint = NULL, category = NULL
              WHERE id = ? AND kind = 'placeholder' AND deleted_at IS NULL`,
          )
          .run(JSON.stringify(key), display, itemId).changes === 1
      );
    }
    const row = this.db
      .prepare('SELECT name FROM presentations WHERE id = ? AND deleted_at IS NULL')
      .get(presentationId) as { name: string } | undefined;
    if (!row) return false;
    return (
      this.db
        .prepare(
          `UPDATE playlist_items SET kind = 'presentation', presentation_id = ?, label = ?, hint = NULL, category = NULL,
                  order_mode = 'presentation', arrangement_id = NULL
            WHERE id = ? AND kind = 'placeholder' AND deleted_at IS NULL`,
        )
        .run(presentationId, row.name, itemId).changes === 1
    );
  }

  /** What an item does to timers when it goes up (none to take them away). Not headers or slots; a video input too. */
  setTimers(itemId: string, cues: readonly TimerCue[]): boolean {
    return (
      this.db
        .prepare(
          `UPDATE playlist_items SET timers = ? WHERE id = ? AND kind IN ('presentation', 'media', 'shastra', 'input') AND deleted_at IS NULL`,
        )
        .run(cues.length > 0 ? JSON.stringify(cues) : null, itemId).changes === 1
    );
  }

  /** A slot's name, and the category its search starts at (or a Shastra passage, or none). */
  editSlot(itemId: string, label: string, category: string | null): boolean {
    return (
      this.db
        .prepare(
          `UPDATE playlist_items SET label = ?, category = ? WHERE id = ? AND kind = 'placeholder' AND hint IS NULL AND deleted_at IS NULL`,
        )
        .run(label, category, itemId).changes === 1
    );
  }

  /** The order a presentation item plays in: the presentation's own, every slide, or one of its arrangements. */
  setItemOrder(itemId: string, order: ItemOrder): boolean {
    const item = this.db
      .prepare(
        "SELECT presentation_id FROM playlist_items WHERE id = ? AND kind = 'presentation' AND deleted_at IS NULL",
      )
      .get(itemId) as { presentation_id: string } | undefined;
    if (!item) return false;
    if (order.mode === 'arrangement') {
      const own = this.db
        .prepare('SELECT 1 FROM arrangements WHERE id = ? AND presentation_id = ?')
        .get(order.arrangementId, item.presentation_id);
      if (!own) return false;
    }
    this.db
      .prepare('UPDATE playlist_items SET order_mode = ?, arrangement_id = ? WHERE id = ?')
      .run(order.mode, order.mode === 'arrangement' ? order.arrangementId : null, itemId);
    return true;
  }

  /** Rename a header. */
  renameHeader(itemId: string, label: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE playlist_items SET label = ? WHERE id = ? AND kind = 'header' AND deleted_at IS NULL",
        )
        .run(label, itemId).changes === 1
    );
  }

  /** Delete for good what was removed before `before` (an ISO time). */
  purgeRemoved(before: string): number {
    return this.db.transaction(
      () =>
        this.db.prepare('DELETE FROM playlists WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
          .changes +
        this.db
          .prepare('DELETE FROM playlist_items WHERE deleted_at IS NOT NULL AND deleted_at < ?')
          .run(before).changes,
    )();
  }
}
